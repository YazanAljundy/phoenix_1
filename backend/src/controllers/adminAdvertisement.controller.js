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
  // `status` picks the list: the pending queue (the default, so every existing
  // caller is unchanged), the approved packages an admin can pause and
  // re-enable, or the rejected ones. Validated in the service.
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  const { rows, hasMore, nextCursor, totalCount } = await service.listPaginatedAdvertisements({
    status,
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

// Every advertisement, every warehouse, every status, unpaginated. The
// management page's Rejected tab no longer needs this (it uses listPending's
// paginated `status=rejected` like the other two tabs) - kept for any other
// caller that wants the full unfiltered set.
const listAll = asyncHandler(async (req, res) => {
  const rows = await service.listAllAdvertisements();
  res.json({ success: true, ...viewModel.toAdvertisementsResponse(rows) });
});

const approve = asyncHandler(async (req, res) => {
  await service.approveAdvertisement(req.params.id, req.user._id);
  res.json({ success: true, message: 'Advertisement approved.' });
});

const reject = asyncHandler(async (req, res) => {
  await service.rejectAdvertisement(req.params.id, req.body.rejectionNote);
  res.json({ success: true, message: 'Advertisement rejected.' });
});

// Direct content edit, at any status - the admin IS the approval authority,
// so there is no buffer/re-review the way a warehouse's own edit re-queues
// the package. Same shape as adminOffer.controller.update.
const update = asyncHandler(async (req, res) => {
  await service.adminUpdateAdvertisement(req.params.id, req.body);
  res.json({ success: true, message: 'Advertisement updated.' });
});

// Hard delete, any warehouse, any status. Same shape as adminOffer.controller.remove.
const remove = asyncHandler(async (req, res) => {
  await service.adminDeleteAdvertisement(req.params.id);
  res.json({ success: true, message: 'Advertisement deleted.' });
});

// Pause or re-enable, either direction - see setAdvertisementAvailability.
const updateAvailability = asyncHandler(async (req, res) => {
  const advertisement = await service.setAdvertisementAvailability(req.params.id, req.body?.isAvailable);
  res.json({
    success: true,
    message: advertisement.isAvailable ? 'Advertisement made available.' : 'Advertisement paused.',
    isAvailable: advertisement.isAvailable,
  });
});

module.exports = { listPending, listAll, approve, reject, update, remove, updateAvailability };
