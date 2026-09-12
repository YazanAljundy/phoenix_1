const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const service = require('../services/adminAdvertisement.service');
const viewModel = require('../viewmodels/adminAdvertisement.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');
const { verifyImageMagicBytes } = require('../middlewares/upload.middleware');
const { uploadImage, deleteImageByUrl } = require('../services/upload.service');

// `items` (an array) and `totalPriceUsd` (a number) travel as plain JSON on
// every existing caller. An optional image turns the request into
// multipart/form-data instead, where every field arrives as a string - this
// is a no-op for a JSON body and only matters once a file is attached. Same
// helper as warehouseAdvertisement.controller.js's own copy.
function normalizeAdvertisementBody(body) {
  const normalized = { ...body };
  if (typeof normalized.items === 'string') {
    try {
      normalized.items = JSON.parse(normalized.items);
    } catch {
      throw ApiError.badRequest('Invalid items.', undefined, 'INVALID_ADVERTISEMENT_ITEMS');
    }
  }
  if (typeof normalized.totalPriceUsd === 'string') {
    normalized.totalPriceUsd = Number(normalized.totalPriceUsd);
  }
  return normalized;
}

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
// the package. Same shape as adminOffer.controller.update. The image is
// optional to replace here too, same mechanism as Banner's own admin edit.
const update = asyncHandler(async (req, res) => {
  let imageUrl;
  if (req.file) {
    if (!verifyImageMagicBytes(req.file.buffer)) {
      throw ApiError.badRequest('Advertisement image file content is not a valid image.');
    }
    imageUrl = await uploadImage(req.file.buffer, 'advertisements');
  }

  const data = normalizeAdvertisementBody(req.body);
  if (imageUrl !== undefined) data.imageUrl = imageUrl;

  try {
    await service.adminUpdateAdvertisement(req.params.id, data);
  } catch (err) {
    if (imageUrl) await deleteImageByUrl(imageUrl);
    throw err;
  }
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
