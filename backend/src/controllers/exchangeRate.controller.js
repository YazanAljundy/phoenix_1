const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const exchangeRateService = require('../services/exchangeRate.service');
const exchangeRateViewModel = require('../viewmodels/exchangeRate.viewmodel');

// Public (any authenticated user) - just the number, no source/manual
// details, see exchangeRate.viewmodel.js. 404 if no rate has ever been
// stored yet (API key never configured and no admin has set one manually) -
// the Flutter client treats that the same as any other fetch failure: fall
// back to SYP-only display, no error UI.
const getPublicRate = asyncHandler(async (req, res) => {
  const rate = await exchangeRateService.getRate();
  if (!rate) {
    throw ApiError.notFound('Exchange rate is not available yet.', 'EXCHANGE_RATE_UNAVAILABLE');
  }
  res.json({ success: true, ...exchangeRateViewModel.toPublicExchangeRateResponse(rate) });
});

module.exports = { getPublicRate };
