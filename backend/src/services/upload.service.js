const cloudinary = require('../config/cloudinary');

// Uploads one file buffer to Cloudinary under `folder` (e.g. 'banners',
// 'returns') and resolves to its permanent https delivery URL. Rejects on
// any Cloudinary error so the caller can clean up / surface a 4xx.
// `resourceType` is 'image' for everything historical (including GIF -
// Cloudinary keeps an animated GIF's frames under the 'image' resource type
// too) and 'video' only for an admin banner's video upload.
function uploadMedia(fileBuffer, folder, resourceType = 'image') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
}

// Every pre-existing call site only ever uploads images - kept as its own
// name so none of them have to pass resourceType.
function uploadImage(fileBuffer, folder) {
  return uploadMedia(fileBuffer, folder, 'image');
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
// `resourceType` must match what the asset was uploaded as - Cloudinary's
// destroy API defaults to 'image' and silently no-ops on a video's public_id
// otherwise.
async function deleteImage(publicId, resourceType = 'image') {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Cloudinary delete failed:', e.message);
  }
}

// A Cloudinary delivery URL embeds the resource type right after the cloud
// name (".../image/upload/..." vs ".../video/upload/...") - only a banner's
// video ever produces the latter today, so sniffing the URL is enough to
// route the destroy call correctly without threading resourceType through
// every caller that only ever held the URL.
function resourceTypeFromUrl(url) {
  return typeof url === 'string' && url.includes('/video/upload/') ? 'video' : 'image';
}

// Convenience wrapper for the call sites that only ever hold the URL.
async function deleteImageByUrl(url) {
  await deleteImage(publicIdFromUrl(url), resourceTypeFromUrl(url));
}

module.exports = { uploadImage, uploadMedia, deleteImage, deleteImageByUrl, publicIdFromUrl };
