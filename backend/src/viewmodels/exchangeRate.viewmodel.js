// The admin panel needs the full picture (source/manualOverride/when) to
// show its "manual rate" warning - the app only ever needs the number
// itself, see toPublicExchangeRateResponse below.
function serializeAdminExchangeRate(rate) {
  if (!rate) {
    return { usdToSyp: null, source: null, lastUpdated: null, manualOverride: false };
  }
  return {
    usdToSyp: rate.usdToSyp,
    source: rate.source,
    lastUpdated: rate.lastUpdated,
    manualOverride: rate.manualOverride,
  };
}

function toAdminExchangeRateResponse(rate) {
  return { exchangeRate: serializeAdminExchangeRate(rate) };
}

function toPublicExchangeRateResponse(rate) {
  return { usdToSyp: rate.usdToSyp };
}

module.exports = { toAdminExchangeRateResponse, toPublicExchangeRateResponse };
