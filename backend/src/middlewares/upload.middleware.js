const multer = require('multer');
const { ApiError } = require('../utils/ApiError');

// Every upload is held in memory only - the route handler streams the buffer
// straight to Cloudinary (services/upload.service.js) and nothing ever
// touches the server's own filesystem.
const storage = multer.memoryStorage();

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_RETURN_PHOTOS = 5;
const MAX_CATALOG_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Magic-byte signatures - checked against the actual buffer content, not
// just the extension or the client-sent MIME type (both are spoofable).
const MAGIC_BYTES = [
  { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: '.webp', bytes: [0x52, 0x49, 0x46, 0x46], riff: true },
];

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageFileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(ApiError.badRequest('Photo must be a JPEG, PNG, or WEBP image.'));
    return;
  }
  cb(null, true);
}

// multer.MulterError (e.g. LIMIT_FILE_SIZE) has no `statusCode`, so the
// generic error handler would otherwise report it as a 500. Map it to a
// proper 400 with a clear message instead.
function wrapMulter(multerMiddleware, tooLargeMessage, tooManyMessage, tooManyCode) {
  return function (req, res, next) {
    multerMiddleware(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(ApiError.badRequest(tooLargeMessage));
        if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
          return next(ApiError.badRequest(tooManyMessage, undefined, tooManyCode));
        }
      }
      return next(err);
    });
  };
}

// Section 6.9/7: "more than one photo allowed" for a return request - capped
// at MAX_RETURN_PHOTOS so a pharmacist can't attach an unbounded batch.
const returnPhotosUpload = wrapMulter(
  multer({
    storage,
    fileFilter: imageFileFilter,
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_RETURN_PHOTOS },
  }).array('images', MAX_RETURN_PHOTOS),
  'Each return photo must be smaller than 5MB.',
  `You can attach at most ${MAX_RETURN_PHOTOS} photos.`,
  'TOO_MANY_RETURN_PHOTOS'
);

// Section 14: the master catalog's Excel import (productCatalog.service.js
// reads straight from `file.buffer`) - same memory storage, just an
// xlsx-only filter and its own size limit.
const catalogImportUpload = wrapMulter(
  multer({
    storage,
    fileFilter: (req, file, cb) => {
      if (file.mimetype !== XLSX_MIME_TYPE) {
        cb(ApiError.badRequest('File must be an .xlsx Excel workbook.'));
        return;
      }
      cb(null, true);
    },
    limits: { fileSize: MAX_CATALOG_IMPORT_SIZE_BYTES },
  }).single('file'),
  'The Excel file must be smaller than 5MB.'
);

// Section: banner media. A warehouse-submitted banner stays image-only
// (unchanged from before this feature); the admin's own upload additionally
// accepts GIF/video, with no size cap (see adminBannerMediaUpload below).
// Split into two named filters (rather than one shared image-only filter)
// per-role instead of duplicating the multer/wrapMulter boilerplate twice.
const BANNER_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']);

function resolveWarehouseBannerMediaType(mimetype) {
  if (ALLOWED_MIME_TYPES.has(mimetype)) return 'image';
  throw ApiError.badRequest('Banner image must be a JPEG, PNG, or WEBP image.', undefined, 'INVALID_MEDIA_TYPE');
}

function resolveAdminBannerMediaType(mimetype) {
  if (mimetype === 'image/gif') return 'gif';
  if (ALLOWED_MIME_TYPES.has(mimetype)) return 'image';
  if (BANNER_VIDEO_MIME_TYPES.has(mimetype)) return 'video';
  throw ApiError.badRequest(
    'Banner media must be a JPEG/PNG/WEBP/GIF image or an MP4/WEBM/MOV video.',
    undefined,
    'INVALID_MEDIA_TYPE'
  );
}

// Wraps a resolver into a multer fileFilter that stashes the resolved kind
// on `file` - multer carries the same object through to req.file, so the
// controller reads it back as req.file.bannerMediaType without re-sniffing
// the MIME type a second time.
function bannerMediaFileFilter(resolveMediaType) {
  return (req, file, cb) => {
    try {
      file.bannerMediaType = resolveMediaType(file.mimetype);
      cb(null, true);
    } catch (err) {
      cb(err);
    }
  };
}

const bannerImageUpload = wrapMulter(
  multer({
    storage,
    fileFilter: bannerMediaFileFilter(resolveWarehouseBannerMediaType),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
  }).single('image'),
  'Banner image must be smaller than 5MB.'
);

// Admin banners only: image, GIF, or video (autoplay in the pharmacy app's
// slider) - deliberately no `limits.fileSize`, since a promotional video may
// be large and the request is for no cap on this path specifically.
const adminBannerMediaUpload = wrapMulter(
  multer({
    storage,
    fileFilter: bannerMediaFileFilter(resolveAdminBannerMediaType),
  }).single('image'),
  'Banner file is too large.'
);

// Delivery seal photo - a single photo the pharmacy attaches when confirming
// a delivery (order.controller.js's confirmDelivery). Same shape as
// bannerImageUpload: one file under the 'image' field, memory-stored, streamed
// straight to Cloudinary.
const deliverySealPhotoUpload = wrapMulter(
  multer({
    storage,
    fileFilter: imageFileFilter,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
  }).single('image'),
  'Seal photo must be smaller than 5MB.'
);

// Checks the first bytes of an in-memory upload against known image
// signatures - a spoofed extension/MIME type won't pass this. Returns false
// (the caller rejects the request) when the content isn't actually one of
// the allowed image types.
function verifyImageMagicBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const head = buffer.subarray(0, 12);

  return MAGIC_BYTES.some((sig) => {
    if (sig.riff) {
      return (
        head.subarray(0, 4).equals(Buffer.from(sig.bytes)) &&
        head.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    }
    return head.subarray(0, sig.bytes.length).equals(Buffer.from(sig.bytes));
  });
}

const GIF_SIGNATURES = [Buffer.from('GIF87a', 'ascii'), Buffer.from('GIF89a', 'ascii')];
const WEBM_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

// Same content-sniffing idea as verifyImageMagicBytes, extended to the two
// extra media kinds only the admin's banner upload accepts. Falls back to
// verifyImageMagicBytes for a plain image so that check never diverges
// between the two call sites.
function verifyBannerMediaMagicBytes(buffer, mediaType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mediaType === 'video') {
    // Every MP4/MOV/M4V container starts with a size word then an 'ftyp'
    // box; WebM/MKV starts with the EBML header instead.
    return buffer.subarray(4, 8).toString('ascii') === 'ftyp' || buffer.subarray(0, 4).equals(WEBM_SIGNATURE);
  }
  if (mediaType === 'gif') {
    return GIF_SIGNATURES.some((sig) => buffer.subarray(0, sig.length).equals(sig));
  }
  return verifyImageMagicBytes(buffer);
}

module.exports = {
  returnPhotosUpload,
  catalogImportUpload,
  bannerImageUpload,
  adminBannerMediaUpload,
  deliverySealPhotoUpload,
  verifyImageMagicBytes,
  verifyBannerMediaMagicBytes,
  resolveAdminBannerMediaType,
  resolveWarehouseBannerMediaType,
  MAX_RETURN_PHOTOS,
};
