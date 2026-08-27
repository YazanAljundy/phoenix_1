const cloudinary = require('../config/cloudinary');

// Uploads one image buffer to Cloudinary under `folder` (e.g. 'banners',
// 'returns') and resolves to its permanent https delivery URL. Rejects on
// any Cloudinary error so the caller can clean up / surface a 4xx.
function uploadImage(fileBuffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
}

// Cloudinary's delete API takes a public_id, not a URL - but everything in
// this codebase stores only the delivery URL (banner.imageUrl,
// return.images[]). This pulls the public_id back out of a URL this service
// produced: everything after `/upload/`, minus the optional `v1234567/`
// version segment and the file extension. Our own uploads carry no
// transformation segment, so this stays a simple slice.
function publicIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const afterUpload = url.split('/upload/')[1];
  if (!afterUpload) return null;
  return afterUpload
    .replace(/^v\d+\//, '')
    .replace(/\.[^./?]+(?:\?.*)?$/, '');
}

// Best-effort delete by public_id - a failure here is logged, never thrown:
// an orphaned Cloudinary asset is not worth failing a user's delete/edit over.
async function deleteImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Cloudinary delete failed:', e.message);
  }
}

// Convenience wrapper for the call sites that only ever hold the URL.
async function deleteImageByUrl(url) {
  await deleteImage(publicIdFromUrl(url));
}

module.exports = { uploadImage, deleteImage, deleteImageByUrl, publicIdFromUrl };
