const { asyncHandler } = require('../utils/asyncHandler');
const service = require('../services/adminAdvertisement.service');
const viewModel = require('../viewmodels/adminAdvertisement.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

// Two shapes on one endpoint, exactly as adminOffer.controller.listPending
// does: no `limit` returns every pending advertisement at once (for a
// dashboard stat card / recent list), while the management page opts into
// pagination by sending `limit`/`after`.
const listPending = asyncHandler(async (req, res) => {
  if (req.query.limit === undefined) {
    const rows = await service.listPendingAdvertisements();
    res.json({ success: true, ...viewModel.toPendingAdvertisementsResponse(rows) });
    return;
  }

  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);
  const { rows, hasMore, nextCursor, totalCount } = await service.listPaginatedPendingAdvertisements({
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...viewModel.toPendingAdvertisementsResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
    totalCount,
  });
});

const approve = asyncHandler(async (req, res) => {
  await service.approveAdvertisement(req.params.id, req.user._id);
  res.json({ success: true, message: 'Advertisement approved.' });
});

const reject = asyncHandler(async (req, res) => {
  await service.rejectAdvertisement(req.params.id, req.body.rejectionNote);
  res.json({ success: true, message: 'Advertisement rejected.' });
});

module.exports = { listPending, approve, reject };
