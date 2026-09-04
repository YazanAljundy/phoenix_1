const { asyncHandler } = require('../utils/asyncHandler');
const adminOfferService = require('../services/adminOffer.service');
const adminOfferViewModel = require('../viewmodels/adminOffer.viewmodel');

// The moderation queue - a brand-new offer, or an approved offer with a parked
// edit. Used by the Dashboard's stat card / recent-list and by the Offers
// page's "Review queue" filter.
const listPending = asyncHandler(async (req, res) => {
  const rows = await adminOfferService.listPendingOffers();
  res.json({ success: true, ...adminOfferViewModel.toPendingOffersResponse(rows) });
});

// Section 5: every offer, every warehouse, every status. Unpaginated - the
// Offers page filters it client-side (status / product / discount).
const listAll = asyncHandler(async (req, res) => {
  const rows = await adminOfferService.listAllOffers();
  res.json({ success: true, ...adminOfferViewModel.toOffersResponse(rows) });
});

const approve = asyncHandler(async (req, res) => {
  await adminOfferService.approveOffer(req.params.id, req.user._id);
  res.json({ success: true, message: 'Offer approved.' });
});

const reject = asyncHandler(async (req, res) => {
  await adminOfferService.rejectOffer(req.params.id);
  res.json({ success: true, message: 'Offer rejected.' });
});

const update = asyncHandler(async (req, res) => {
  await adminOfferService.adminUpdateOffer(req.params.id, req.body);
  res.json({ success: true, message: 'Offer updated.' });
});

const remove = asyncHandler(async (req, res) => {
  await adminOfferService.adminDeleteOffer(req.params.id);
  res.json({ success: true, message: 'Offer deleted.' });
});

module.exports = { listPending, listAll, approve, reject, update, remove };
