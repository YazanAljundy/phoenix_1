const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('../utils/ApiError');

// TODO(production): this whole module stores files on the server's local
// filesystem. That's fine for local dev but does NOT survive on hosts with an
// ephemeral filesystem (Render, Railway) across restarts/redeploys - migrate
// to Cloudflare R2 (see Section 15/env.r2) before any real production deploy.
const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
const VERIFICATION_PHOTOS_DIR = path.join(UPLOAD_ROOT, 'verification-photos');
const RETURN_PHOTOS_DIR = path.join(UPLOAD_ROOT, 'return-photos');
fs.mkdirSync(VERIFICATION_PHOTOS_DIR, { recursive: true });
fs.mkdirSync(RETURN_PHOTOS_DIR, { recursive: true });

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_RETURN_PHOTOS = 5;
const MAX_CATALOG_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Magic-byte signatures - checked against actual file content after upload,
// not just the extension or the client-sent MIME type (both are spoofable).
const MAGIC_BYTES = [
  { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: '.webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, riff: true },
];

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function makeStorage(destinationDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destinationDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });
}

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

const verificationPhotoUpload = wrapMulter(
  multer({
    storage: makeStorage(VERIFICATION_PHOTOS_DIR),
    fileFilter: imageFileFilter,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
  }).single('verificationPhoto'),
  'Verification photo must be smaller than 5MB.'
);

// Section 6.9/7: "more than one photo allowed" for a return request - capped
// at MAX_RETURN_PHOTOS so a pharmacist can't attach an unbounded batch.
const returnPhotosUpload = wrapMulter(
  multer({
    storage: makeStorage(RETURN_PHOTOS_DIR),
    fileFilter: imageFileFilter,
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_RETURN_PHOTOS },
  }).array('images', MAX_RETURN_PHOTOS),
  'Each return photo must be smaller than 5MB.',
  `You can attach at most ${MAX_RETURN_PHOTOS} photos.`,
  'TOO_MANY_RETURN_PHOTOS'
);

// Section 14: the master catalog's Excel import (productCatalog.service.js
// reads straight from `file.buffer`, nothing touches disk) - memory storage
// rather than makeStorage's disk-based one, since there's no reason to keep
// the file around after it's parsed.
const catalogImportUpload = wrapMulter(
  multer({
    storage: multer.memoryStorage(),
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

// Reads the first bytes of the saved file and checks them against known image
// signatures - a spoofed extension/MIME type won't pass this. Deletes the
// file and throws if the content doesn't actually match an allowed image type.
function verifyImageMagicBytes(filePath) {
  const buffer = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 12, 0);
  fs.closeSync(fd);

  const matches = MAGIC_BYTES.some((sig) => {
    if (sig.riff) {
      return (
        buffer.slice(0, 4).equals(Buffer.from(sig.bytes)) &&
        buffer.slice(8, 12).toString('ascii') === 'WEBP'
      );
    }
    return buffer.slice(0, sig.bytes.length).equals(Buffer.from(sig.bytes));
  });

  if (!matches) {
    fs.unlinkSync(filePath);
    return false;
  }
  return true;
}

module.exports = {
  verificationPhotoUpload,
  returnPhotosUpload,
  catalogImportUpload,
  verifyImageMagicBytes,
  VERIFICATION_PHOTOS_DIR,
  RETURN_PHOTOS_DIR,
  MAX_RETURN_PHOTOS,
};
