const { asyncHandler } = require('../utils/asyncHandler');
const offerService = require('../services/offer.service');
const offerViewModel = require('../viewmodels/offer.viewmodel');

const listActive = asyncHandler(async (req, res) => {
  const rows = await offerService.listActiveOffers();
  res.json({ success: true, ...offerViewModel.toActiveOffersResponse(rows) });
});

module.exports = { listActive };
