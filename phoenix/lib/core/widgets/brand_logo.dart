import 'package:flutter/material.dart';

import '../extensions/build_context_extensions.dart';

/// The FENIQ logo, in whichever cut suits the surface it is painted on.
///
/// The identity ships two colourways - a navy-winged one for light grounds and
/// a silver-winged one for dark grounds - so which file to use is a property of
/// the *background*, not of the screen. Three constructors cover the cases the
/// app actually has, which keeps every call site from re-deciding it:
///
///  * [BrandLogo] - follows the active theme (light theme -> navy cut).
///  * [BrandLogo.onDark] - always the silver cut, for surfaces that are dark in
///    both themes (the splash ground, a navy app bar).
///  * [BrandLogo.mark] - bird only, no wordmark; the lockup is nearly twice as
///    tall as it is wide, so in a 32px app-bar slot the wordmark would render
///    at roughly two pixels a letter.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.width, this.height})
    : _variant = _Variant.themed,
      _markOnly = false;

  /// For surfaces that are dark regardless of the active theme.
  const BrandLogo.onDark({super.key, this.width, this.height})
    : _variant = _Variant.silver,
      _markOnly = false;

  /// Bird only - for tight slots (app bar leading, avatars) where the wordmark
  /// would be too small to read. Follows the theme unless [onDark] is set.
  const BrandLogo.mark({super.key, this.width, this.height, bool onDark = false})
    : _variant = onDark ? _Variant.silver : _Variant.themed,
      _markOnly = true;

  final double? width;
  final double? height;
  final _Variant _variant;
  final bool _markOnly;

  @override
  Widget build(BuildContext context) {
    final silver = switch (_variant) {
      _Variant.silver => true,
      _Variant.themed => context.isDarkMode,
    };
    final name = _markOnly ? 'feniq_mark' : 'feniq_logo';
    final tone = silver ? 'dark' : 'light';

    return Image(
      image: AssetImage('assets/images/${name}_$tone.png'),
      width: width,
      height: height,
      fit: BoxFit.contain,
    );
  }
}

enum _Variant { themed, silver }
