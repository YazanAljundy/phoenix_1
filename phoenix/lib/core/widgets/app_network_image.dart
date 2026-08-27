import 'package:flutter/material.dart';

import '../constants/app_colors.dart';

/// The one way the app loads a remote image. A failed load - 404, 403, a
/// dead URL, no connection - never reaches the user as an exception or
/// Flutter's broken-image glyph; it shows a calm themed placeholder instead
/// (the reason this exists: a banner image 404 was surfacing
/// "HTTP request failed, statusCode: 404" in the UI).
///
/// A null / empty [url] renders the same placeholder without even trying a
/// request. Pass [fallback] to override the placeholder, or [fallbackIcon]
/// to just change its glyph.
class AppNetworkImage extends StatelessWidget {
  const AppNetworkImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.width,
    this.height,
    this.fallbackIcon = Icons.image_not_supported_outlined,
    this.fallback,
  });

  final String? url;
  final BoxFit fit;
  final double? width;
  final double? height;
  final IconData fallbackIcon;
  final Widget? fallback;

  Widget _placeholder(BuildContext context) =>
      fallback ??
      Container(
        width: width,
        height: height,
        color: AppColors.surfaceOf(context),
        alignment: Alignment.center,
        child: Icon(fallbackIcon, color: AppColors.textSecondaryOf(context)),
      );

  @override
  Widget build(BuildContext context) {
    final trimmed = url?.trim() ?? '';
    if (trimmed.isEmpty) return _placeholder(context);

    return Image.network(
      trimmed,
      fit: fit,
      width: width,
      height: height,
      errorBuilder: (context, error, stackTrace) => _placeholder(context),
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Container(
          width: width,
          height: height,
          color: AppColors.surfaceOf(context),
          alignment: Alignment.center,
          child: const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        );
      },
    );
  }
}
