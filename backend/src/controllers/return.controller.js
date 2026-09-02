const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const returnService = require('../services/return.service');
const returnViewModel = require('../viewmodels/return.viewmodel');
const { verifyImageMagicBytes } = require('../middlewares/upload.middleware');
const { uploadImage, deleteImageByUrl } = require('../services/upload.service');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

const RETURNS_DEFAULT_LIMIT = 15;

async function loadPharmacyOrThrow(userId) {
  // Runs on every order/return/review/debt request and only ever yields
  // `pharmacy._id` to its callers, so neither the rest of the document nor
  // Mongoose hydration is needed.
  const pharmacy = await Pharmacy.findOne({ userId }).select('_id').lean();
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

// Verifies every attached buffer is really an image, then streams them all
// to Cloudinary under `returns/` and returns their delivery URLs. The
// magic-byte check runs first so a junk file is rejected before any upload
// is spent.
async function verifyAndUploadImages(files) {
  for (const file of files) {
    if (!verifyImageMagicBytes(file.buffer)) {
      throw ApiError.badRequest(
        'One of the attached photos is not a valid image.',
        undefined,
        'INVALID_RETURN_PHOTO'
      );
    }
  }
  return Promise.all(files.map((file) => uploadImage(file.buffer, 'returns')));
}

const create = asyncHandler(async (req, res) => {
  const files = req.files ?? [];

  const { orderId, notes } = req.body;
  if (typeof orderId !== 'string') {
    throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  }
  const items = parseJsonField(req.body.items, null, 'INVALID_ITEMS_FORMAT');

  const images = await verifyAndUploadImages(files);

  let result;
  try {
    const pharmacy = await loadPharmacyOrThrow(req.user._id);
    result = await returnService.createReturn({
      pharmacyId: pharmacy._id,
      orderId,
      items,
      notes,
      images,
    });
  } catch (err) {
    // The return was rejected (window expired, bad item, …) after the photos
    // were already uploaded - drop them so the failure leaves no orphans.
    await Promise.all(images.map((url) => deleteImageByUrl(url)));
    throw err;
  }

  res.status(201).json({
    success: true,
    message: 'Return request submitted.',
    ...returnViewModel.toReturnResponse(result.returnRequest, result.orderItemById),
  });
});

const update = asyncHandler(async (req, res) => {
  const files = req.files ?? [];

  const items = parseJsonField(req.body.items, null, 'INVALID_ITEMS_FORMAT');
  const keepImageUrls = parseJsonField(req.body.keepImageUrls, [], 'INVALID_KEEP_IMAGES_FORMAT');
  const newImages = await verifyAndUploadImages(files);

  let result;
  try {
    const pharmacy = await loadPharmacyOrThrow(req.user._id);
    result = await returnService.updateReturn({
      pharmacyId: pharmacy._id,
      returnId: req.params.id,
      items,
      notes: req.body.notes,
      keepImageUrls,
      newImages,
    });
  } catch (err) {
    await Promise.all(newImages.map((url) => deleteImageByUrl(url)));
    throw err;
  }

  res.json({
    success: true,
    message: 'Return request updated.',
    ...returnViewModel.toReturnResponse(result.returnRequest, result.orderItemById),
  });
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
