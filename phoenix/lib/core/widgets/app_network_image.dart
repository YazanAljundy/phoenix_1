import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../utils/cloudinary_image.dart';

/// The one way the app loads a remote image.
///
/// Responsibilities:
///  * **Cache** - on-disk + in-memory via [CachedNetworkImage]; the same URL
///    is downloaded once per device, then served from cache (including when
///    it appears in several widgets at once).
///  * **Right-sizing** - for Cloudinary URLs, rewrites the URL to fetch a
///    version scaled to the widget's real painted size (device pixels), and
///    caps the decoded bitmap with `memCacheWidth`/`memCacheHeight` so an
///    80x80 thumbnail never keeps a 4000px bitmap in RAM. Non-Cloudinary
///    URLs are still cached and decode-capped, just not URL-rewritten.
///  * **Graceful failure** - a 404 / dead URL / no connection never reaches
///    the user as an exception or Flutter's broken-image glyph; it shows a
///    calm themed placeholder. A null / empty [url] renders that placeholder
///    without even attempting a request.
///
/// Pass [fallback] to override the empty/error widget, or [fallbackIcon] to
/// just change its glyph. Pass [borderRadius] to have the image (and its
/// placeholders) clipped without an extra `ClipRRect` at the call site.
class AppNetworkImage extends StatelessWidget {
  const AppNetworkImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.width,
    this.height,
    this.fallbackIcon = Icons.image_not_supported_outlined,
    this.fallback,
    this.borderRadius,
    this.crop = false,
  });

  final String? url;
  final BoxFit fit;
  final double? width;
  final double? height;
  final IconData fallbackIcon;
  final Widget? fallback;
  final BorderRadius? borderRadius;

  /// Cloudinary crop strategy: `false` = `c_limit` (keep aspect ratio),
  /// `true` = `c_fill` (crop to the exact box). See [cloudinaryOptimizedUrl].
  final bool crop;

  // Upper bounds so an unbounded / buggy layout constraint can never turn
  // into a request for (or a decode of) a giant image. 1400 logical px covers
  // a full-width image on the largest tablet; 2400 device px caps the decoded
  // bitmap regardless of pixel ratio.
  static const double _maxTargetLogicalPx = 1400;
  static const int _maxTargetDevicePx = 2400;

  // Shown for null/empty [url] and for a failed load - the "there is no image
  // here" state.
  Widget _emptyState(BuildContext context) =>
      fallback ??
      Container(
        width: width,
        height: height,
        color: AppColors.surfaceOf(context),
        alignment: Alignment.center,
        child: Icon(fallbackIcon, color: AppColors.textSecondaryOf(context)),
      );

  // Shown while the image is in flight - a calm neutral block, no spinner and
  // no animation (a grid can hold dozens of these at once, and once cached
  // they never appear at all).
  Widget _loadingState(BuildContext context) => Container(
    width: width,
    height: height,
    color: AppColors.surfaceOf(context),
  );

  Widget _clip(Widget child) {
    if (borderRadius == null) return child;
    return ClipRRect(borderRadius: borderRadius!, child: child);
  }

  @override
  Widget build(BuildContext context) {
    final trimmed = url?.trim() ?? '';
    if (trimmed.isEmpty) return _clip(_emptyState(context));

    final dpr = MediaQuery.devicePixelRatioOf(context);

    return _clip(
      LayoutBuilder(
        builder: (context, constraints) {
          final logicalW = _resolveExtent(width, constraints.maxWidth);
          final logicalH = _resolveExtent(height, constraints.maxHeight);

          final targetW = _devicePx(logicalW, dpr);
          final targetH = _devicePx(logicalH, dpr);

          final resolvedUrl = cloudinaryOptimizedUrl(
            trimmed,
            width: targetW,
            height: targetH,
            crop: crop,
          );

          // Decode cap. Cloudinary's `w_`/`h_` already right-sized the bytes;
          // this is the belt-and-suspenders cap for non-Cloudinary URLs.
          //  * crop (c_fill): the image is meant to exactly fill the box, so
          //    both dims are safe to pin.
          //  * no crop (c_limit): only ever pin ONE dimension - passing both
          //    targetWidth+targetHeight to the decoder stretches to that exact
          //    box, ignoring aspect ratio. One dimension scales proportionally.
          final int? memW;
          final int? memH;
          if (crop && targetW != null && targetH != null) {
            memW = targetW;
            memH = targetH;
          } else {
            memW = targetW ?? targetH;
            memH = null;
          }

          return CachedNetworkImage(
            imageUrl: resolvedUrl,
            fit: fit,
            width: width,
            height: height,
            // Advertise WebP so Cloudinary's f_auto actually serves it (the
            // Dart HTTP client sends no image Accept header by default).
            httpHeaders: const {'Accept': 'image/webp,image/*;q=0.8'},
            memCacheWidth: memW,
            memCacheHeight: memH,
            fadeInDuration: const Duration(milliseconds: 200),
            placeholder: (context, _) => _loadingState(context),
            errorWidget: (context, _, __) => _emptyState(context),
          );
        },
      ),
    );
  }

  /// Prefers an explicit finite extent; otherwise a finite layout constraint;
  /// otherwise null (apply no size hint). Everything is clamped so a stray
  /// unbounded/huge constraint can't request an oversized image.
  static double? _resolveExtent(double? explicit, double constraint) {
    if (explicit != null && explicit.isFinite && explicit > 0) {
      return explicit.clamp(1.0, _maxTargetLogicalPx);
    }
    if (constraint.isFinite && constraint > 0) {
      return constraint.clamp(1.0, _maxTargetLogicalPx);
    }
    return null;
  }

  static int? _devicePx(double? logical, double dpr) {
    if (logical == null) return null;
    return (logical * dpr).round().clamp(1, _maxTargetDevicePx);
  }
}
