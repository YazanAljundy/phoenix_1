// One place for the "process before upload" settings, so every image the
// user picks is optimised the same way before it is sent on to the backend
// (which streams it straight to Cloudinary, untouched - see
// backend/src/services/upload.service.js).
//
// The processing itself is done natively by image_picker in a single pass
// (maxWidth/maxHeight + imageQuality on pickImage/pickMultiImage). There is
// no separate compress step and no temporary files of our own to clean up -
// image_picker writes the processed copy into the OS cache directory and
// hands back an XFile pointing at it.

/// Longest-edge cap, in pixels, for a user-picked photo before upload
/// (double because that is what image_picker's maxWidth/maxHeight take).
/// A phone camera shot (e.g. 4032x3024) is scaled down to fit inside a
/// square of this size, keeping aspect ratio; images already smaller are
/// left as-is (never upscaled). 1600 keeps plenty of detail for a return
/// photo / warehouse review while cutting the pixel count ~4-6x.
const double kReturnPhotoMaxDimension = 1600;

/// JPEG re-encode quality (0-100) applied by image_picker during the same
/// pass. 80 is visibly clean and roughly halves the encoded size versus the
/// camera default - deliberately not lower, to avoid a mushy image.
const int kReturnPhotoQuality = 80;
