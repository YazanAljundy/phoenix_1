import 'package:flutter/material.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';

// Phoenix brand palette (Section 5 of the spec): white backgrounds, green for
// medical/confirmation/positive, navy for professionalism/headers, orange for
// primary buttons/CTAs, red for warnings/cancel/danger.
class AppColors {
  AppColors._();

  // Section 5's five mandatory brand colors - exact values, not approximations.
  static const Color _lightPrimary = Color(0xFFF57C00); // orange - CTAs
  static const Color _lightSecondary = Color(0xFF2E7D32); // green - medical/positive
  static const Color _lightNavy = Color(0xFF1A237E); // navy - headers
  static const Color _lightBackground = Color(0xFFFFFFFF);
  static const Color _lightSurface = Color(0xFFF4F6F9);
  static const Color _lightBorder = Color(0xFFE2E6ED);
  static const Color _lightError = Color(0xFFC62828); // red - warnings/danger
  static const Color _lightText = Color(0xFF14161B);
  static const Color _lightTextSecondary = Color(0xFF5F6673);

  // A second, whiter surface tier for content that should read as "raised"
  // above the page (cards) rather than "recessed into" it (input fills) -
  // both map to the same flat grey in Material's default Card/Input theming,
  // which is why cards and fields used to look identical.
  static const Color _lightSurfaceElevated = Color(0xFFFFFFFF);
  static const Color _darkSurfaceElevated = Color(0xFF1C2028);

  static const Color _darkPrimary = Color(0xFFFFA733);
  static const Color _darkSecondary = Color(0xFF6FBF73);
  static const Color _darkNavy = Color(0xFF8C97DB);
  static const Color _darkBackground = Color(0xFF0E1014);
  static const Color _darkSurface = Color(0xFF15181E);
  static const Color _darkBorder = Color(0xFF2A303B);
  static const Color _darkError = Color(0xFFF0625E);
  static const Color _darkText = Color(0xFFECEEF3);
  static const Color _darkTextSecondary = Color(0xFF98A0AE);

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
