/// Rewrites Cloudinary delivery URLs to request a display-sized,
/// auto-format, auto-quality rendition instead of the untouched original.
///
/// Every user-uploaded image in this app (banner images, return photos,
/// warehouse logos) is streamed straight to Cloudinary by the backend and
/// stored as its plain `secure_url` - no transformation segment
/// (see backend/src/services/upload.service.js). Those originals can be
/// several thousand pixels wide; this asks Cloudinary for a version scaled
/// to what the widget actually draws.
///
/// Safety rules:
///  * Only `res.cloudinary.com` `/image/upload/` URLs are touched.
///  * A URL that already carries a transformation segment is returned
///    unchanged (never stack a second set).
///  * Anything unparseable or non-Cloudinary is returned verbatim.
///  * Never throws.
library;

const String _cloudinaryHost = 'res.cloudinary.com';
const String _uploadMarker = '/image/upload/';

final RegExp _transformSegment = RegExp(r'^[a-z]{1,3}_[^/]+$');
final RegExp _versionSegment = RegExp(r'^v\d+$');

/// Whether [url] is a Cloudinary image delivery URL this helper can rewrite.
bool isCloudinaryUrl(String? url) {
  if (url == null || url.isEmpty) return false;
  return url.contains(_cloudinaryHost) && url.contains(_uploadMarker);
}

/// Returns [url] rewritten to fetch a right-sized rendition.
///
/// [width] / [height] are the target size **in device pixels** (logical
/// pixels x devicePixelRatio) - i.e. what the image is actually painted at.
/// Pass whichever are known; passing neither still applies `f_auto,q_auto`.
///
/// [crop]:
///  * `false` (default) -> `c_limit`: scale to fit inside width x height,
///    preserving aspect ratio, never upscaling. Safe for everything - the
///    Flutter widget's own BoxFit does any cropping locally on the already
///    small image.
///  * `true` -> `c_fill`: fill width x height exactly, cropping the
///    overflow server-side. Only for fixed-size thumbnails where the source
///    aspect ratio genuinely does not matter.
///
/// Non-Cloudinary / already-transformed / empty URLs come back unchanged.
String cloudinaryOptimizedUrl(
  String url, {
  int? width,
  int? height,
  bool crop = false,
}) {
  if (!isCloudinaryUrl(url)) return url;

  final markerIndex = url.indexOf(_uploadMarker);
  final headEnd = markerIndex + _uploadMarker.length;
  final head = url.substring(0, headEnd); // ".../image/upload/"
  final tail = url.substring(headEnd); // "v123/folder/id.jpg"
  if (tail.isEmpty) return url;

  // First path segment after /upload/ is normally the version ("v1699999999")
  // or the folder name. A segment that looks like Cloudinary param syntax
  // ("w_600", "c_fill,f_auto", ...) means transformations are already there.
  final firstSegment = tail.split('/').first;
  final alreadyTransformed =
      firstSegment.contains(',') ||
      (_transformSegment.hasMatch(firstSegment) &&
          !_versionSegment.hasMatch(firstSegment));
  if (alreadyTransformed) return url;

  final hasWidth = width != null && width > 0;
  final hasHeight = height != null && height > 0;

  final params = <String>['f_auto', 'q_auto'];
  if (hasWidth) params.add('w_$width');
  if (hasHeight) params.add('h_$height');
  if (hasWidth || hasHeight) params.add(crop ? 'c_fill' : 'c_limit');

  return '$head${params.join(',')}/$tail';
}
