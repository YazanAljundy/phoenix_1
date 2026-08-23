const { messaging } = require('../config/firebase');
const User = require('../models/user.model');
const Notification = require('../models/notification.model');

// FCM's own hard cap per sendEachForMulticast call.
const FCM_BATCH_SIZE = 500;
const OFFER_RATE_LIMIT_MS = 24 * 60 * 60 * 1000;

// Token error codes FCM returns for a token that will never work again -
// cleaned up from the user's deviceTokens on sight rather than left to fail
// silently on every future send forever.
const DEAD_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
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
  const recent = await Notification.findOne({ userId, type: 'offer', createdAt: { $gte: since } });
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
    if (await isRateLimited(userId, payload.type)) return;

    const user = await User.findById(userId, 'deviceTokens lang');
    if (!user) return;

    await Notification.create({
      userId,
      titleAr: payload.titleAr,
      titleEn: payload.titleEn,
      bodyAr: payload.bodyAr,
      bodyEn: payload.bodyEn,
      type: payload.type,
      relatedOrderId: payload.relatedOrderId ?? null,
      sentByAdminId: payload.sentByAdminId ?? null,
    });

    const tokens = user.deviceTokens.map((d) => d.fcmToken);
    if (!messaging || tokens.length === 0) return;

    const { title, body } = pickLang(user, payload);
    const baseMessage = {
      notification: { title, body },
      data: {
        type: payload.type,
        ...(payload.relatedOrderId ? { relatedOrderId: String(payload.relatedOrderId) } : {}),
      },
    };

    const deadTokens = [];
    for (const tokenBatch of chunk(tokens, FCM_BATCH_SIZE)) {
      const response = await messaging.sendEachForMulticast({ ...baseMessage, tokens: tokenBatch });
      response.responses.forEach((result, index) => {
        if (!result.success && DEAD_TOKEN_ERROR_CODES.has(result.error?.code)) {
          deadTokens.push(tokenBatch[index]);
        }
      });
    }
    await removeDeadTokens(userId, deadTokens);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Notification send failed (sendToUser).', err.message);
  }
}

// Fan-out to many users at once (e.g. every active pharmacy for a new
// offer, or every active user for an admin broadcast). Each user still gets
// their own Notification document and their own rate-limit check via
// sendToUser - independent per user, not one shared multicast - since those
// two things can't be shared across users anyway. Run concurrently since
// sendToUser never throws (each user's failure is isolated and logged on
// its own).
async function sendToAll(userIds, payload) {
  await Promise.all(userIds.map((userId) => sendToUser(userId, payload)));
}

module.exports = { sendToUser, sendToAll };
