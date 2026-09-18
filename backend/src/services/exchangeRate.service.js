const { ApiError } = require('../utils/ApiError');
const ExchangeRate = require('../models/exchangeRate.model');
const ExchangeRateHistory = require('../models/exchangeRateHistory.model');
const financialAudit = require('./financialAudit.service');

const SINGLETON_ID = 'singleton';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const DAILY_REFRESH_HOUR = 9; // 09:00 server-local time

// LiraScope's public endpoint - no key. `currencies=USD` is sent as documented
// but the live API ignores it and returns every currency, so the parser below
// filters for USD itself.
const LIRASCOPE_LATEST_URL = 'https://lirascope.syria-cloud.sy/api/v1/rates/latest?currencies=USD';
// The fetch runs from the daily tick, but also inside the admin's "reset to
// API" request, which waits on it - so it must not hang.
const PROVIDER_TIMEOUT_MS = 10 * 1000;
// LiraScope keeps serving a currency's last quote when its feed stops (several
// non-USD entries are months old), so an old timestamp is how a dead USD feed
// shows up. A week comfortably spans a weekend without market updates.
const MAX_RATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 60 * 1000;

function validateUsdToSyp(usdToSyp) {
  if (typeof usdToSyp !== 'number' || !Number.isFinite(usdToSyp) || usdToSyp <= 0) {
    throw ApiError.badRequest('Invalid exchange rate.', undefined, 'INVALID_EXCHANGE_RATE');
  }
}

// .lean(): every caller reads `usdToSyp` (order pricing) or serialises the
// row through a viewmodel. Nothing saves it - the three write paths in this
// file all use findByIdAndUpdate rather than mutating a loaded document.
async function getRate() {
  return ExchangeRate.findById(SINGLETON_ID).lean();
}

// Money-Flow V2. Appends to the append-only history whenever the stored rate
// actually MOVES - the daily API refresh usually re-fetches the same number,
// and a row per no-op fetch would bury the real changes.
//
// Best-effort by design: the history is provenance, not the rate itself, so a
// failure here must never stop a rate from being stored or an order from being
// priced. It is logged instead.
async function recordRateChange({ usdToSyp, source, previousUsdToSyp, changedBy = null }) {
  if (previousUsdToSyp === usdToSyp) return null;
  try {
    const row = await ExchangeRateHistory.create({
      usdToSyp,
      source,
      effectiveFrom: new Date(),
      changedBy,
      previousUsdToSyp: previousUsdToSyp ?? null,
    });
    await financialAudit.record({
      action: 'exchangeRate.changed',
      actorId: changedBy,
      actorRole: changedBy ? 'admin' : 'system',
      entityType: 'ExchangeRate',
      before: { usdToSyp: previousUsdToSyp ?? null },
      after: { usdToSyp, source },
    });
    return row;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to record an exchange-rate change in the history.', err.message);
    return null;
  }
}

// Far below any real rate move; only absorbs floating-point noise from the
// rate's JSON round trip through the panel.
const RATE_EPSILON = 1e-6;

// The panel converts the SYP a user types into the USD the catalog stores, at
// the rate it loaded - which can be hours old by the time it saves (the daily
// 09:00 refresh and an admin's manual change never reach an open tab). So a
// write whose USD figure came out of that conversion carries `rateUsed`, and
// is refused here unless that is still the rate on record: RATE_CHANGED names
// both, and the panel re-checks the amount at the new rate before saving again.
//
// The one check for every such write - product create/price edit,
// the warehouse's order limits, advertisement totals. Each caller decides
// whether its write depends on the rate at all (an unchanged stored value
// does not). `required` is set at the HTTP boundary: a panel request that
// converted something must say at which rate. A direct service caller that
// passes no rate is not checked. Returns the current rate row when checked.
//
// Not atomic with the write that follows: a rate that moves in the few
// milliseconds between this read and that write is not caught.
async function assertRateUsedIsCurrent(rateUsed, { required = true } = {}) {
  if (rateUsed === undefined || rateUsed === null || rateUsed === '') {
    if (!required) return null;
    throw ApiError.badRequest(
      'This amount was converted from SYP without the exchange rate it used. Reload the page and try again.',
      undefined,
      'RATE_USED_REQUIRED'
    );
  }
  const used = Number(rateUsed);
  if (!Number.isFinite(used) || used <= 0) {
    throw ApiError.badRequest('Invalid exchange rate.', undefined, 'INVALID_RATE_USED');
  }

  const current = await getRate();
  if (!current) {
    throw ApiError.badRequest(
      'Exchange rate is not available yet - this amount cannot be checked.',
      undefined,
      'EXCHANGE_RATE_UNAVAILABLE'
    );
  }
  if (Math.abs(current.usdToSyp - used) > RATE_EPSILON) {
    throw new ApiError(
      409,
      'The exchange rate changed since this amount was converted. Review the new amount and save again.',
      { rateUsed: used, currentUsdToSyp: current.usdToSyp },
      'RATE_CHANGED'
    );
  }
  return current;
}

// Money-Flow V2. THE place a money event gets its exchange rate.
//
// Every Order, Payment and LedgerEntry freezes what this returns, so the
// figures it produced never move again - a later change to the singleton only
// prices NEW events. Callers that cannot proceed without a rate (order
// creation) throw on null; callers that can (reporting) fall back.
async function captureFxSnapshot({ source = null } = {}) {
  const rate = await getRate();
  if (!rate) return null;
  return {
    rate: rate.usdToSyp,
    source: source ?? rate.source ?? 'api',
    rateAsOf: rate.lastUpdated ?? new Date(),
    estimated: false,
  };
}

// Picks the USD parallel-market rate out of a LiraScope /rates/latest body.
// The automatic rate is the market `mid` (product decision) - never
// cbsRates (the official rate) or effectiveRates. LiraScope already quotes the
// "new" (post-redenomination) lira, so the value is stored as-is.
//
// Throws on anything unusable, so the caller's fallback keeps the last stored
// rate rather than overwriting it with a bad one.
function parseLiraScopeUsdRate(data, now = new Date()) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.marketRates)) {
    throw new Error('LiraScope response did not include marketRates.');
  }
  const entry = data.marketRates.find((r) => r && r.currency === 'USD');
  if (!entry) {
    throw new Error('LiraScope response did not include a USD market rate.');
  }
  const { mid, buy, sell, timestampUtc } = entry;
  if (typeof mid !== 'number' || !Number.isFinite(mid) || mid <= 0) {
    throw new Error(`LiraScope USD market rate is not a positive number (mid=${JSON.stringify(mid)}).`);
  }
  const asOfMs = typeof timestampUtc === 'string' ? Date.parse(timestampUtc) : NaN;
  if (Number.isNaN(asOfMs)) {
    throw new Error(`LiraScope USD market rate has an invalid timestamp (${JSON.stringify(timestampUtc)}).`);
  }
  if (now.getTime() - asOfMs > MAX_RATE_AGE_MS) {
    throw new Error(`LiraScope USD market rate is stale (as of ${timestampUtc}).`);
  }
  if (asOfMs - now.getTime() > MAX_FUTURE_SKEW_MS) {
    throw new Error(`LiraScope USD market rate is dated in the future (${timestampUtc}).`);
  }
  return {
    usdToSyp: mid,
    mid,
    buy,
    sell,
    rateAsOf: new Date(asOfMs),
    responseTimestampUtc: data.timestampUtc ?? null,
  };
}

async function fetchRateFromApi() {
  let response;
  try {
    response = await fetch(LIRASCOPE_LATEST_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      throw new Error(`LiraScope request timed out after ${PROVIDER_TIMEOUT_MS}ms.`);
    }
    throw new Error(`LiraScope request failed: ${err && err.message}`);
  }

  if (!response.ok) {
    if (response.status === 429) {
      const body = await response.json().catch(() => null);
      const retryAfter = body && body.retryAfter != null ? ` (retry after ${body.retryAfter}s)` : '';
      throw new Error(`LiraScope rate limit exceeded (HTTP 429)${retryAfter}.`);
    }
    throw new Error(`LiraScope request failed with status ${response.status}.`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      throw new Error(`LiraScope request timed out after ${PROVIDER_TIMEOUT_MS}ms.`);
    }
    throw new Error('LiraScope response was not valid JSON.');
  }

  return {
    ...parseLiraScopeUsdRate(data),
    rateLimitRemaining: response.headers.get('x-rate-limit-remaining'),
  };
}

async function fetchAndStoreFromApi() {
  const { usdToSyp, rateAsOf, rateLimitRemaining } = await fetchRateFromApi();
  const previous = await getRate();
  // The fetch above is a network round trip - several seconds, sometimes the
  // full PROVIDER_TIMEOUT_MS - during which an admin's setManualRate can land.
  // `previous` is read right after it returns, so it already reflects
  // whichever one won; applying this fetch's result on top of a pin that was
  // set while it was in flight would silently undo the admin's change. (Not
  // this path's job to react to a *deliberate* reset, either - that's
  // resetToApi, which clears manualOverride itself before ever reaching here,
  // so `previous` correctly reads false for it once that clear has landed.)
  if (previous && previous.manualOverride) {
    // eslint-disable-next-line no-console
    console.log(
      'Exchange rate API write skipped - a manual override was set while this fetch was in flight.'
    );
    return previous;
  }
  const rate = await ExchangeRate.findByIdAndUpdate(
    SINGLETON_ID,
    { usdToSyp, source: 'api', lastUpdated: new Date(), manualOverride: false },
    { upsert: true, new: true }
  );
  await recordRateChange({ usdToSyp, source: 'api', previousUsdToSyp: previous?.usdToSyp ?? null });
  const quota = rateLimitRemaining != null ? ` [${rateLimitRemaining} requests left in LiraScope's window]` : '';
  // eslint-disable-next-line no-console
  console.log(
    `Exchange rate updated from LiraScope (market mid, rate as of ${rateAsOf.toISOString()}): 1 USD = ${usdToSyp} SYP.${quota}`
  );
  return rate;
}

// The 24h cron tick (see startScheduledRefresh below): skips entirely once
// an admin has pinned a manual rate, and never lets a failed request
// disturb whatever rate is already stored - same "degrade, don't break"
// contract as the OTP/image providers elsewhere in this codebase.
async function refreshFromApi() {
  const current = await getRate();
  if (current && current.manualOverride) {
    // eslint-disable-next-line no-console
    console.log('Exchange rate refresh skipped - an admin-set manual rate is pinned.');
    return;
  }

  try {
    await fetchAndStoreFromApi();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Exchange rate refresh failed - keeping the last known rate.', err.message);
  }
}

// Milliseconds until the next 09:00 server-local time (today if it hasn't
// passed yet, tomorrow otherwise).
function msUntilNextDailyRefresh() {
  const now = new Date();
  const next = new Date();
  next.setHours(DAILY_REFRESH_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return { delayMs: next.getTime() - now.getTime(), next };
}

// Runs once a day at a fixed clock time (09:00) rather than 24h from
// whenever the server happened to last boot - no cron dependency needed for
// a single fixed daily time: a setTimeout to the first 09:00, then a plain
// 24h setInterval from there on.
//
// Boot itself only triggers an immediate fetch when the collection is
// genuinely empty (first-ever boot) - once a rate exists, a restart just
// waits for the next scheduled tick instead of spending an extra API call.
async function startScheduledRefresh() {
  const existing = await getRate();
  if (!existing) {
    await refreshFromApi();
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `Exchange rate already stored (1 USD = ${existing.usdToSyp} SYP, ${existing.source}) - skipping the boot-time fetch.`
    );
  }

  const { delayMs, next } = msUntilNextDailyRefresh();
  // eslint-disable-next-line no-console
  console.log(`Next rate update scheduled for 09:00 on ${next.toDateString()}.`);

  setTimeout(() => {
    refreshFromApi();
    setInterval(refreshFromApi, REFRESH_INTERVAL_MS);
  }, delayMs);
}

// The admin's manual override. Deliberately unchanged in its validation: any
// positive number is accepted, with no bounds/sanity check and no approval
// step (product owner's decision). What V2 adds is the paper trail - the
// previous value is preserved in the history and the change is audited.
async function setManualRate(usdToSyp, changedBy = null) {
  validateUsdToSyp(usdToSyp);
  const previous = await getRate();
  const rate = await ExchangeRate.findByIdAndUpdate(
    SINGLETON_ID,
    { usdToSyp, source: 'manual', lastUpdated: new Date(), manualOverride: true },
    { upsert: true, new: true }
  );
  await recordRateChange({
    usdToSyp,
    source: 'manual',
    previousUsdToSyp: previous?.usdToSyp ?? null,
    changedBy,
  });
  return rate;
}

// The rates the singleton has held, newest first - shown beside the admin's
// rate card so a change is visible in context rather than replacing the only
// copy of the old number. Cursor-paginated on `_id` rather than `effectiveFrom`
// - the two orderings always agree, since recordRateChange stamps
// effectiveFrom with `new Date()` at the exact moment it creates the row and
// nothing ever backdates it - but `_id` is what every other cursor-paginated
// list in the app sorts and cursors on (see offer.service.js's
// listPaginatedOffers), so this stays consistent with that rather than
// inventing its own convention.
async function listRateHistory({ limit = 20, after = null } = {}) {
  const filter = after !== null ? { _id: { $lt: after } } : {};
  const rows = await ExchangeRateHistory.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;
  return { rows: page, hasMore, nextCursor };
}

// Admin-triggered "hand control back to the API". Always clears
// manualOverride immediately (so the next cron tick will refresh it
// regardless), then makes a best-effort immediate fetch for instant
// feedback in the panel. If that immediate fetch fails, `source`/`usdToSyp`
// are left as they were until the next successful cron tick - manualOverride
// is already false by then, so cron will pick it up.
async function resetToApi() {
  await ExchangeRate.findByIdAndUpdate(
    SINGLETON_ID,
    { manualOverride: false },
    { upsert: true, new: true }
  );

  try {
    await fetchAndStoreFromApi();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      'Exchange rate immediate refresh after reset failed - will retry on the next cron tick.',
      err.message
    );
  }

  return getRate();
}

module.exports = {
  getRate,
  captureFxSnapshot,
  assertRateUsedIsCurrent,
  recordRateChange,
  listRateHistory,
  refreshFromApi,
  startScheduledRefresh,
  setManualRate,
  resetToApi,
  parseLiraScopeUsdRate,
};
