const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const service = require('../services/warehouseAdvertisement.service');
const viewModel = require('../viewmodels/warehouseAdvertisement.viewmodel');
const { verifyImageMagicBytes } = require('../middlewares/upload.middleware');
const { uploadImage, deleteImageByUrl } = require('../services/upload.service');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

// `items` (an array) and `totalPriceUsd` (a number) travel as plain JSON on
// every existing caller. An optional image turns the request into
// multipart/form-data instead, where every field arrives as a string - this
// is a no-op for a JSON body (fields already have the right type) and only
// matters once a file is attached.
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

// Resolves the optional uploaded image, same mechanism as Banner: verify the
// magic bytes, then upload to Cloudinary. Returns undefined (not null) when
// no file was sent, so the caller can tell "no new image" apart from
// "clear the image" - buildAdvertisementFields only touches `imageUrl` when
// the caller actually sets the key.
async function resolveUploadedImage(req) {
  if (!req.file) return undefined;
  if (!verifyImageMagicBytes(req.file.buffer)) {
    throw ApiError.badRequest('Advertisement image file content is not a valid image.');
  }
  return uploadImage(req.file.buffer, 'advertisements');
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  const rows = await service.listAdvertisementsForWarehouse(warehouse._id, status);
  res.json({ success: true, ...viewModel.toAdvertisementListResponse(rows) });
});

const create = asyncHandler(async (req, res) => {
  const imageUrl = await resolveUploadedImage(req);
  const data = normalizeAdvertisementBody(req.body);
  if (imageUrl !== undefined) data.imageUrl = imageUrl;

  let row;
  try {
    const warehouse = await loadWarehouseOrThrow(req.user._id);
    // The total was converted from SYP in the panel - it must carry the rate
    // it used (exchangeRate.service.js's assertRateUsedIsCurrent).
    row = await service.createAdvertisement(warehouse._id, data, { requireRateUsed: true });
  } catch (err) {
    if (imageUrl) await deleteImageByUrl(imageUrl);
    throw err;
  }
  res.status(201).json({
    success: true,
    message: 'Advertisement submitted for approval.',
    ...viewModel.toAdvertisementResponse(row),
  });
});

const update = asyncHandler(async (req, res) => {
  // Only set when a new file was actually uploaded - omitting the key (not
  // setting it to null) is what lets buildAdvertisementFields leave the
  // existing image untouched on a normal content edit.
  const imageUrl = await resolveUploadedImage(req);
  const data = normalizeAdvertisementBody(req.body);
  if (imageUrl !== undefined) data.imageUrl = imageUrl;

  let row;
  try {
    const warehouse = await loadWarehouseOrThrow(req.user._id);
    row = await service.updateAdvertisement(req.params.id, warehouse._id, data, { requireRateUsed: true });
  } catch (err) {
    if (imageUrl) await deleteImageByUrl(imageUrl);
    throw err;
  }
  res.json({
    success: true,
    message: 'Advertisement updated.',
    ...viewModel.toAdvertisementResponse(row),
  });
});

const remove = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  await service.deleteAdvertisement(req.params.id, warehouse._id);
  res.json({ success: true, message: 'Advertisement deleted.' });
});

// Either direction - see updateAdvertisementAvailability. Restricted to an
// approved package there (400 ADVERTISEMENT_NOT_APPROVED otherwise).
const updateAvailability = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const row = await service.updateAdvertisementAvailability(
    req.params.id,
    warehouse._id,
    req.body?.isAvailable
  );
  res.json({
    success: true,
    message: row.advertisement.isAvailable ? 'Advertisement made available.' : 'Advertisement paused.',
    ...viewModel.toAdvertisementResponse(row),
  });
});

module.exports = { list, create, update, remove, updateAvailability };
