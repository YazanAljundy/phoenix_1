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

// Section: banner image - a single required photo, same shape as
// returnPhotosUpload above (single file instead of an array), just its own
// field name.
const bannerImageUpload = wrapMulter(
  multer({
    storage,
    fileFilter: imageFileFilter,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
  }).single('image'),
  'Banner image must be smaller than 5MB.'
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

module.exports = {
  returnPhotosUpload,
  catalogImportUpload,
  bannerImageUpload,
  verifyImageMagicBytes,
  MAX_RETURN_PHOTOS,
};
