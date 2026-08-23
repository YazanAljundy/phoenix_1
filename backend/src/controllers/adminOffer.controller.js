const { asyncHandler } = require('../utils/asyncHandler');
const adminOfferService = require('../services/adminOffer.service');
const adminOfferViewModel = require('../viewmodels/adminOffer.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

// Two shapes on one endpoint: the Dashboard's stat card/recent-list calls
// this with no `limit` and needs every pending offer at once - only the
// Offers management page opts into pagination by sending `limit`/`after`.
const listPending = asyncHandler(async (req, res) => {
  if (req.query.limit === undefined) {
    const rows = await adminOfferService.listPendingOffers();
    res.json({ success: true, ...adminOfferViewModel.toPendingOffersResponse(rows) });
    return;
  }

  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);
  const { rows, hasMore, nextCursor, totalCount } = await adminOfferService.listPaginatedPendingOffers({
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...adminOfferViewModel.toPendingOffersResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
    totalCount,
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

module.exports = { listPending, approve, reject };
