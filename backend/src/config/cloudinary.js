const { v2: cloudinary } = require('cloudinary');
const config = require('./env');

// Every user-uploaded image (banner images, return photos) is streamed
// straight to Cloudinary from memory - nothing is ever written to the
// server's own filesystem (which is ephemeral on Render/Railway anyway).
// See services/upload.service.js for the upload/delete helpers and
// middlewares/upload.middleware.js for the multer memory storage.
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true,
});

if (!config.cloudinary.cloudName || !config.cloudinary.apiKey || !config.cloudinary.apiSecret) {
  // eslint-disable-next-line no-console
  console.warn(
    'Cloudinary is not fully configured (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET) - image uploads will fail until it is.'
  );
}

module.exports = cloudinary;
