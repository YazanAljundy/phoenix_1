const { asyncHandler } = require('../utils/asyncHandler');
const adminOfferService = require('../services/adminOffer.service');
const adminOfferViewModel = require('../viewmodels/adminOffer.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

// The moderation queue - a brand-new offer, or an approved offer with a parked
// edit. Used by the Dashboard's stat card / recent-list only (the Offers
// page's own "Review queue" pill now goes through listAll below, like every
// other status pill).
const listPending = asyncHandler(async (req, res) => {
  const rows = await adminOfferService.listPendingOffers();
  res.json({ success: true, ...adminOfferViewModel.toPendingOffersResponse(rows) });
});

// Section 5: every offer, every warehouse, every status - filtered (status
// pill / search / discount range) and always cursor-paginated. No "give me
// everything" shape: `limit` always gets a default (parseCursorQuery), never
// unbounded, unlike the two-shapes pattern most other list endpoints use -
// this one has no other caller that needs the unbounded form.
const listAll = asyncHandler(async (req, res) => {
  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const minDiscount = typeof req.query.minDiscount === 'string' ? req.query.minDiscount : undefined;
  const maxDiscount = typeof req.query.maxDiscount === 'string' ? req.query.maxDiscount : undefined;

  const { rows, hasMore, nextCursor, reviewCount } = await adminOfferService.listPaginatedAllOffers({
    status,
    search,
    minDiscount,
    maxDiscount,
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...adminOfferViewModel.toOffersResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
    reviewCount,
  });
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
