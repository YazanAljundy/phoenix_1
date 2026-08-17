const env = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const ExchangeRate = require('../models/exchangeRate.model');

const SINGLETON_ID = 'singleton';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function validateUsdToSyp(usdToSyp) {
  if (typeof usdToSyp !== 'number' || !Number.isFinite(usdToSyp) || usdToSyp <= 0) {
    throw ApiError.badRequest('Invalid exchange rate.', undefined, 'INVALID_EXCHANGE_RATE');
  }
}

async function getRate() {
  return ExchangeRate.findById(SINGLETON_ID);
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
  const rate = await ExchangeRate.findByIdAndUpdate(
    SINGLETON_ID,
    { usdToSyp, source: 'api', lastUpdated: new Date(), manualOverride: false },
    { upsert: true, new: true }
  );
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

// Runs once at boot (so a rate exists as soon as possible) and then every
// 24h - a plain setInterval rather than a cron dependency, since a fixed
// daily period is all this needs.
function startScheduledRefresh() {
  refreshFromApi();
  setInterval(refreshFromApi, REFRESH_INTERVAL_MS);
}

async function setManualRate(usdToSyp) {
  validateUsdToSyp(usdToSyp);
  return ExchangeRate.findByIdAndUpdate(
    SINGLETON_ID,
    { usdToSyp, source: 'manual', lastUpdated: new Date(), manualOverride: true },
    { upsert: true, new: true }
  );
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
  refreshFromApi,
  startScheduledRefresh,
  setManualRate,
  resetToApi,
};
