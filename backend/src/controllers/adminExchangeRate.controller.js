const { asyncHandler } = require('../utils/asyncHandler');
const exchangeRateService = require('../services/exchangeRate.service');
const exchangeRateViewModel = require('../viewmodels/exchangeRate.viewmodel');

// Unlike the public endpoint, this always returns 200 - even with no rate
// stored yet - so the panel can render the card in an empty state and let
// the admin type in a first rate right away.
const getRate = asyncHandler(async (req, res) => {
  const rate = await exchangeRateService.getRate();
  res.json({ success: true, ...exchangeRateViewModel.toAdminExchangeRateResponse(rate) });
});

const setManualRate = asyncHandler(async (req, res) => {
  const rate = await exchangeRateService.setManualRate(req.body.usdToSyp);
  res.json({ success: true, ...exchangeRateViewModel.toAdminExchangeRateResponse(rate) });
});

const resetToApi = asyncHandler(async (req, res) => {
  const rate = await exchangeRateService.resetToApi();
  res.json({ success: true, ...exchangeRateViewModel.toAdminExchangeRateResponse(rate) });
});

module.exports = { getRate, setManualRate, resetToApi };
