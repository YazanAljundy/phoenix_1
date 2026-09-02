const { messaging } = require('../config/firebase');
const User = require('../models/user.model');
const Notification = require('../models/notification.model');

// FCM's own hard cap per sendEachForMulticast call.
const FCM_BATCH_SIZE = 500;

// The TEMP DIAGNOSTIC logging below (added for the FCM_DEBUG task) writes six
// lines per recipient. That is fine for one order-status notification and
// costly for a broadcast: at 535 recipients it is ~3,200 synchronous stdout
// writes on the event loop, during the exact window the fan-out is already
// the heaviest thing running. Kept, but opt-in - set NOTIFICATION_DEBUG=true
// to get the original behaviour back while debugging delivery.
const NOTIFICATION_DEBUG = process.env.NOTIFICATION_DEBUG === 'true';

function debugLog(...args) {
  if (!NOTIFICATION_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

const OFFER_RATE_LIMIT_MS = 24 * 60 * 60 * 1000;

// Token error codes FCM returns for a token that will never work again -
// cleaned up from the user's deviceTokens on sight rather than left to fail
// silently on every future send forever.
//
// 'messaging/invalid-argument' is included so malformed tokens get purged
// too, but it's FCM's generic "request was malformed" code - a bad message
// payload (not the token) returns the same code, and would then wrongly
// wipe every token in that batch, working ones included. Accepted
// deliberately for now to auto-clean malformed tokens; if that ever
// happens, this is why.
const DEAD_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

function pickLang(user, payload) {
  const isArabic = (user.lang || 'ar') === 'ar';
  return {
    title: isArabic ? payload.titleAr : payload.titleEn,
    body: isArabic ? payload.bodyAr : payload.bodyEn,
  };
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function removeDeadTokens(userId, deadTokens) {
  if (deadTokens.length === 0) return;
  await User.updateOne({ _id: userId }, { $pull: { deviceTokens: { fcmToken: { $in: deadTokens } } } });
}

// At most one 'offer' notification per pharmacy per rolling 24h - checked
// against the notifications collection itself (the durable record of what
// was already sent), not a separate cache.
async function isRateLimited(userId, type) {
  if (type !== 'offer') return false;
  const since = new Date(Date.now() - OFFER_RATE_LIMIT_MS);
  // Existence check only - nothing reads the document.
  const recent = await Notification.findOne(
    { userId, type: 'offer', createdAt: { $gte: since } }
  ).select('_id').lean();
  return Boolean(recent);
}

// Sends to every device currently registered for one user, and always
// records the in-app Notification regardless of whether any device is
// reachable right now (a user with zero registered devices still sees this
// in their notification history next time they open the app - just no push
// banner). Never throws - every caller (an order status change, an offer
// approval...) already succeeded before this runs and must not be undone by
// a notification failure, so this is defensive on its own terms too.
async function sendToUser(userId, payload) {
  try {
    // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task) - no full tokens.
    debugLog('NOTIFICATION_DEBUG: sendToUser started');
    debugLog(`NOTIFICATION_DEBUG: userId = ${userId}`);
    debugLog(`NOTIFICATION_DEBUG: notification type = ${payload.type}`);

    if (await isRateLimited(userId, payload.type)) {
      debugLog('NOTIFICATION_DEBUG: rate limited - skipping send');
      return;
    }

    // .lean(): only `deviceTokens` and `lang` are read. Dead-token cleanup
    // below goes through User.updateOne, not through this document.
    const user = await User.findById(userId, 'deviceTokens lang').lean();
    debugLog(`NOTIFICATION_DEBUG: user found = ${Boolean(user)}`);
    if (!user) return;

    await Notification.create({
      userId,
      titleAr: payload.titleAr,
      titleEn: payload.titleEn,
      bodyAr: payload.bodyAr,
      bodyEn: payload.bodyEn,
      type: payload.type,
      relatedOrderId: payload.relatedOrderId ?? null,
      relatedComplaintId: payload.relatedComplaintId ?? null,
      sentByAdminId: payload.sentByAdminId ?? null,
    });
    debugLog('NOTIFICATION_DEBUG: Notification.create() succeeded');

    // `|| []` matters specifically because of .lean(): a hydrated document
    // gets the schema's `default: []` applied, a lean one does not. A user
    // record predating the deviceTokens field would otherwise throw here -
    // caught by the wrapper below, but only after the Notification row had
    // already been written, which is not what used to happen.
    const tokens = (user.deviceTokens || []).map((d) => d.fcmToken);
    debugLog(`NOTIFICATION_DEBUG: device token count = ${tokens.length}`);
    debugLog(`NOTIFICATION_DEBUG: messaging initialized = ${Boolean(messaging)}`);
    if (!messaging || tokens.length === 0) {
      debugLog('NOTIFICATION_DEBUG: skipping FCM send (no messaging or no tokens)');
      return;
    }

    const { title, body } = pickLang(user, payload);
    const baseMessage = {
      notification: { title, body },
      data: {
        type: payload.type,
        ...(payload.relatedOrderId ? { relatedOrderId: String(payload.relatedOrderId) } : {}),
        ...(payload.relatedComplaintId
          ? { relatedComplaintId: String(payload.relatedComplaintId) }
          : {}),
      },
    };

    const deadTokens = [];
    for (const tokenBatch of chunk(tokens, FCM_BATCH_SIZE)) {
      debugLog(`NOTIFICATION_DEBUG: sending FCM multicast, batch size = ${tokenBatch.length}`);
      const response = await messaging.sendEachForMulticast({ ...baseMessage, tokens: tokenBatch });
      debugLog(`NOTIFICATION_DEBUG: successCount = ${response.successCount}`);
      debugLog(`NOTIFICATION_DEBUG: failureCount = ${response.failureCount}`);
      response.responses.forEach((result, index) => {
        if (!result.success) {
          debugLog(`NOTIFICATION_DEBUG: failure error.code = ${result.error?.code}`);
        }
        if (!result.success && DEAD_TOKEN_ERROR_CODES.has(result.error?.code)) {
          deadTokens.push(tokenBatch[index]);
        }
      });
    }
    debugLog(`NOTIFICATION_DEBUG: removeDeadTokens called = ${deadTokens.length > 0}`);
    await removeDeadTokens(userId, deadTokens);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Notification send failed (sendToUser).', err.message);
  }
}

// How many recipients are in flight at once during a fan-out.
//
// This used to be unbounded - `Promise.all` over every recipient - which meant
// an admin broadcast issued one User.findById plus one Notification.create per
// user simultaneously. Measured at 535 recipients, that pinned the event loop
// and the connection pool hard enough to take an unrelated single-document
// read (GET /exchange-rate) from a 13 ms median to 1,242 ms for the duration
// of the broadcast, recovering only once it finished. At 10,000 users the same
// pattern extrapolates to tens of seconds of degradation for every other
// request in flight.
//
// 20 keeps the driver's 100-connection pool comfortably clear of exhaustion
// (each recipient holds at most one connection at a time) while still
// finishing a broadcast quickly.
const FANOUT_CONCURRENCY = 20;

// A fixed pool of workers pulling from a shared cursor. Chosen over chunking
// so a single slow recipient - an FCM multicast to a user with many devices -
// stalls only its own worker rather than a whole batch boundary, and over
// Promise.all so the array of pending promises can never grow with the
// recipient count.
async function mapWithConcurrency(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
      } catch (err) {
        // sendToUser already swallows its own errors, so this should never
        // fire. It is here because without it a single unexpected throw would
        // kill that worker and, if it happened on every worker, silently drop
        // the tail of the broadcast - which the previous Promise.all did not
        // do. One failed recipient must never cost the others.
        // eslint-disable-next-line no-console
        console.error('Notification fan-out: recipient failed.', err && err.message);
      }
    }
  });
  await Promise.all(runners);
}

// Fan-out to many users at once (e.g. every active pharmacy for a new
// offer, or every active user for an admin broadcast). Each user still gets
// their own Notification document and their own rate-limit check via
// sendToUser - independent per user, not one shared multicast - since those
// two things can't be shared across users anyway.
//
// Still concurrent, just bounded. sendToUser continues to swallow its own
// errors, so one failed recipient neither aborts the broadcast nor rejects
// here - unchanged from before.
async function sendToAll(userIds, payload) {
  await mapWithConcurrency(userIds, FANOUT_CONCURRENCY, (userId) => sendToUser(userId, payload));
}

module.exports = { sendToUser, sendToAll, _mapWithConcurrency: mapWithConcurrency, FANOUT_CONCURRENCY };
