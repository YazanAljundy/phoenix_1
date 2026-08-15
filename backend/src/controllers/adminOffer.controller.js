const { asyncHandler } = require('../utils/asyncHandler');
const adminOfferService = require('../services/adminOffer.service');
const adminOfferViewModel = require('../viewmodels/adminOffer.viewmodel');

const listPending = asyncHandler(async (req, res) => {
  const rows = await adminOfferService.listPendingOffers();
  res.json({ success: true, ...adminOfferViewModel.toPendingOffersResponse(rows) });
});

const approve = asyncHandler(async (req, res) => {
  await adminOfferService.approveOffer(req.params.id, req.user._id);
  res.json({ success: true, message: 'Offer approved.' });
});

const reject = asyncHandler(async (req, res) => {
  await adminOfferService.rejectOffer(req.params.id);
  res.json({ success: true, message: 'Offer rejected.' });
});

module.exports = { listPending, approve, reject };
