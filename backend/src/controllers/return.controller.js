const fs = require('fs');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const returnService = require('../services/return.service');
const returnViewModel = require('../viewmodels/return.viewmodel');
const { verifyImageMagicBytes } = require('../middlewares/upload.middleware');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

const RETURNS_DEFAULT_LIMIT = 15;

async function loadPharmacyOrThrow(userId) {
  const pharmacy = await Pharmacy.findOne({ userId });
  if (!pharmacy) {
    throw ApiError.notFound('Pharmacy profile not found.', 'PHARMACY_NOT_FOUND');
  }
  return pharmacy;
}

// `items` (and, on update, `keepImageUrls`) travel as a JSON string alongside
// the uploaded files - multipart/form-data has no native way to carry a
// structured array otherwise.
function parseJsonField(raw, fallback, code) {
  if (raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw ApiError.badRequest('Invalid request format.', undefined, code);
  }
}

function verifyAndBuildImageUrls(req, files) {
  for (const file of files) {
    if (!verifyImageMagicBytes(file.path)) {
      throw ApiError.badRequest(
        'One of the attached photos is not a valid image.',
        undefined,
        'INVALID_RETURN_PHOTO'
      );
    }
  }
  return files.map(
    (file) => `${req.protocol}://${req.get('host')}/uploads/return-photos/${file.filename}`
  );
}

const create = asyncHandler(async (req, res) => {
  const files = req.files ?? [];
  const cleanupUploadedFiles = () => {
    for (const file of files) fs.unlink(file.path, () => {});
  };

  try {
    const { orderId, notes } = req.body;
    if (typeof orderId !== 'string') {
      throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
    }
    const items = parseJsonField(req.body.items, null, 'INVALID_ITEMS_FORMAT');

    const images = verifyAndBuildImageUrls(req, files);
    const pharmacy = await loadPharmacyOrThrow(req.user._id);

    const { returnRequest, orderItemById } = await returnService.createReturn({
      pharmacyId: pharmacy._id,
      orderId,
      items,
      notes,
      images,
    });

    res.status(201).json({
      success: true,
      message: 'Return request submitted.',
      ...returnViewModel.toReturnResponse(returnRequest, orderItemById),
    });
  } catch (err) {
    cleanupUploadedFiles();
    throw err;
  }
});

const update = asyncHandler(async (req, res) => {
  const files = req.files ?? [];
  const cleanupUploadedFiles = () => {
    for (const file of files) fs.unlink(file.path, () => {});
  };

  try {
    const items = parseJsonField(req.body.items, null, 'INVALID_ITEMS_FORMAT');
    const keepImageUrls = parseJsonField(req.body.keepImageUrls, [], 'INVALID_KEEP_IMAGES_FORMAT');
    const newImages = verifyAndBuildImageUrls(req, files);

    const pharmacy = await loadPharmacyOrThrow(req.user._id);
    const { returnRequest, orderItemById } = await returnService.updateReturn({
      pharmacyId: pharmacy._id,
      returnId: req.params.id,
      items,
      notes: req.body.notes,
      keepImageUrls,
      newImages,
    });

    res.json({
      success: true,
      message: 'Return request updated.',
      ...returnViewModel.toReturnResponse(returnRequest, orderItemById),
    });
  } catch (err) {
    cleanupUploadedFiles();
    throw err;
  }
});

const remove = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  await returnService.deleteReturn({ pharmacyId: pharmacy._id, returnId: req.params.id });
  res.json({ success: true, message: 'Return request deleted.' });
});

const list = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const { limit, after } = parseCursorQuery(req.query, RETURNS_DEFAULT_LIMIT);
  const cursor = parseObjectIdCursor(after);

  const { rows, hasMore, nextCursor } = await returnService.listReturnsForPharmacy(pharmacy._id, {
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...returnViewModel.toReturnListResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

module.exports = { create, update, remove, list };
