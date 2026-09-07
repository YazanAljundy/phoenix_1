const env = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const ExchangeRate = require('../models/exchangeRate.model');
const ExchangeRateHistory = require('../models/exchangeRateHistory.model');
const financialAudit = require('./financialAudit.service');

const SINGLETON_ID = 'singleton';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const DAILY_REFRESH_HOUR = 9; // 09:00 server-local time

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

// Open Exchange Rates' rates.SYP is the pre-redenomination lira - this app
// prices everything in the "new" lira (old ÷ 100), so that conversion
// happens right here, once, rather than at every read site.
async function fetchRateFromApi() {
  const url = `https://openexchangerates.org/api/latest.json?app_id=${env.exchangeRateApiKey}&symbols=SYP`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open Exchange Rates request failed with status ${response.status}.`);
  }
  const data = await response.json();
  const oldLiraPerUsd = data && data.rates && data.rates.SYP;
  if (typeof oldLiraPerUsd !== 'number' || !Number.isFinite(oldLiraPerUsd)) {
    throw new Error('Open Exchange Rates response did not include a usable SYP rate.');
  }
  return oldLiraPerUsd / 100;
}

async function fetchAndStoreFromApi() {
  const usdToSyp = await fetchRateFromApi();
  const previous = await getRate();
  const rate = await ExchangeRate.findByIdAndUpdate(
    SINGLETON_ID,
    { usdToSyp, source: 'api', lastUpdated: new Date(), manualOverride: false },
    { upsert: true, new: true }
  );
  await recordRateChange({ usdToSyp, source: 'api', previousUsdToSyp: previous?.usdToSyp ?? null });
  // eslint-disable-next-line no-console
  console.log(`Exchange rate updated from API: 1 USD = ${usdToSyp} SYP.`);
  return rate;
}

// The 24h cron tick (see startScheduledRefresh below): skips entirely once
// an admin has pinned a manual rate, and never lets a failed request
// disturb whatever rate is already stored - same "degrade, don't break"
// contract as the OTP/image providers elsewhere in this codebase.
async function refreshFromApi() {
  const current = await getRate();
  if (current && current.manualOverride) return;

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
// copy of the old number.
async function listRateHistory({ limit = 20 } = {}) {
  return ExchangeRateHistory.find({}).sort({ effectiveFrom: -1 }).limit(limit).lean();
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
  recordRateChange,
  listRateHistory,
  refreshFromApi,
  startScheduledRefresh,
  setManualRate,
  resetToApi,
};
