import 'package:flutter/material.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';

// FENIQ brand palette, taken from the new phoenix-bird identity: the bird's
// orange body is the primary/CTA colour, its wing supplies the navy (day) and
// silver (night) neutrals, and green/red stay on as the semantic pair for
// medical-positive and danger.
//
// The three brand hexes below are the identity's own values; they were checked
// against the logo artwork itself (assets/branding/source/) before being
// adopted, not eyeballed - see assets/branding/README.md for the measured
// values and how far each sits from the one in use.
//
// Kept in sync by hand with web/src/index.css's --color-*, --wh-* and --adm-*
// token blocks, which mirror these same values for the React panels.
class AppColors {
  AppColors._();

  static const Color _brandOrange = Color(0xFFF2760A); // bird's body - CTAs
  static const Color _brandOrangeLight = Color(0xFFFFA94D); // gradient top end
  static const Color _brandOrangeDeep = Color(0xFFE8600A); // gradient bottom end
  static const Color _brandNavy = Color(0xFF16283F); // wing, day mode
  static const Color _brandNavyDark = Color(0xFF0E1A2C); // night-mode ground
  static const Color _brandSilver = Color(0xFFE4E7EB); // wing, night mode

  static const Color _lightPrimary = _brandOrange; // orange - CTAs
  static const Color _lightSecondary = Color(0xFF2E7D32); // green - medical/positive
  static const Color _lightNavy = _brandNavy; // navy - headers
  static const Color _lightBackground = Color(0xFFF7F7F8);
  static const Color _lightSurface = Color(0xFFEDEEF1);
  static const Color _lightBorder = Color(0xFFDCDFE5);
  static const Color _lightError = Color(0xFFC62828); // red - warnings/danger
  static const Color _lightText = _brandNavy;
  static const Color _lightTextSecondary = Color(0xFF5C6B7F);

  // A second, whiter surface tier for content that should read as "raised"
  // above the page (cards) rather than "recessed into" it (input fills) -
  // both map to the same flat grey in Material's default Card/Input theming,
  // which is why cards and fields used to look identical.
  static const Color _lightSurfaceElevated = Color(0xFFFFFFFF);
  static const Color _darkSurfaceElevated = Color(0xFF1B2C45);

  static const Color _darkPrimary = _brandOrangeLight;
  static const Color _darkSecondary = Color(0xFF6FBF73);
  // "navy" is the brand-surface role (splash ground, warehouse-selection app
  // bar) and is always painted with white foreground on top, so in night mode
  // it stays navy - just lifted off _brandNavyDark enough to read as a
  // distinct surface. The silver end of the identity is carried by _darkText.
  static const Color _darkNavy = Color(0xFF1B2C45);
  static const Color _darkBackground = _brandNavyDark;
  static const Color _darkSurface = Color(0xFF16243A);
  static const Color _darkBorder = Color(0xFF243651);
  static const Color _darkError = Color(0xFFF0625E);
  static const Color _darkText = _brandSilver;
  static const Color _darkTextSecondary = Color(0xFF9AA6B8);

  // The identity's orange gradient, for the few surfaces that want the bird's
  // shaded body rather than a flat fill (brand CTAs, splash wash).
  static const Color brandOrangeLight = _brandOrangeLight;
  static const Color brandOrangeDeep = _brandOrangeDeep;
  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [_brandOrangeLight, _brandOrangeDeep],
  );

  static Color get lightPrimary => _lightPrimary;
  static Color get lightSecondary => _lightSecondary;
  static Color get lightNavy => _lightNavy;
  static Color get lightBackground => _lightBackground;
  static Color get lightSurface => _lightSurface;
  static Color get lightSurfaceElevated => _lightSurfaceElevated;
  static Color get lightBorder => _lightBorder;
  static Color get lightError => _lightError;
  static Color get lightText => _lightText;
  static Color get lightTextSecondary => _lightTextSecondary;

  static Color get darkPrimary => _darkPrimary;
  static Color get darkSecondary => _darkSecondary;
  static Color get darkNavy => _darkNavy;
  static Color get darkBackground => _darkBackground;
  static Color get darkSurface => _darkSurface;
  static Color get darkSurfaceElevated => _darkSurfaceElevated;
  static Color get darkBorder => _darkBorder;
  static Color get darkError => _darkError;
  static Color get darkText => _darkText;
  static Color get darkTextSecondary => _darkTextSecondary;

  static Color get primary => lightPrimary;
  static Color get secondary => lightSecondary;
  static Color get navy => lightNavy;
  static Color get background => lightBackground;
  static Color get surface => lightSurface;
  static Color get border => lightBorder;
  static Color get error => lightError;
  static Color get text => lightText;
  static Color get textSecondary => lightTextSecondary;

  /// Warning/attention tone (an order changed under the pharmacy's feet, say).
  /// Distinct from [errorOf], which means "this failed". Both modes lean on the
  /// identity's orange rather than a fresh hue, so the app has one warm accent.
  static Color warningOf(BuildContext context) =>
      context.isDarkMode ? _brandOrangeLight : _brandOrangeDeep;

  /// The low-emphasis fill behind a [warningOf] message.
  static Color warningSurfaceOf(BuildContext context) => Color.alphaBlend(
    warningOf(context).withValues(alpha: context.isDarkMode ? 0.18 : 0.12),
    surfaceElevatedOf(context),
  );

  static Color primaryOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? darkPrimary
      : lightPrimary;

  static Color secondaryOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? darkSecondary
      : lightSecondary;

  static Color navyOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? darkNavy : lightNavy;

  static Color backgroundOf(BuildContext context) =>
      context.isDarkMode 
      ? darkBackground
      : lightBackground;

  static Color surfaceOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? darkSurface
      : lightSurface;

  static Color surfaceElevatedOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? darkSurfaceElevated
      : lightSurfaceElevated;

  static Color borderOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? darkBorder
      : lightBorder;

  static Color errorOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? darkError : lightError;

  static Color textOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? darkText : lightText;

  static Color textSecondaryOf(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? darkTextSecondary
      : lightTextSecondary;
}
