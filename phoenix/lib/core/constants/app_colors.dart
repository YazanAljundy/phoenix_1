import 'package:flutter/material.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';

// Phoenix brand palette (Section 5 of the spec): white backgrounds, green for
// medical/confirmation/positive, navy for professionalism/headers, orange for
// primary buttons/CTAs, red for warnings/cancel/danger.
class AppColors {
  AppColors._();

  static const Color _lightPrimary = Color(0xFFFF7A00); // orange - CTAs
  static const Color _lightSecondary = Color(0xFF1E8E5A); // green - medical/positive
  static const Color _lightNavy = Color(0xFF0B2545); // navy - headers
  static const Color _lightBackground = Color(0xFFFFFFFF);
  static const Color _lightSurface = Color(0xFFF6F7F9);
  static const Color _lightBorder = Color(0xFFE0E0E0);
  static const Color _lightError = Color(0xFFD32F2F); // red - warnings/danger
  static const Color _lightText = Color(0xFF14213D);
  static const Color _lightTextSecondary = Color(0xFF5A6B87);

  static const Color _darkPrimary = Color(0xFFFF9142);
  static const Color _darkSecondary = Color(0xFF4CAF7D);
  static const Color _darkNavy = Color(0xFF13345C);
  static const Color _darkBackground = Color(0xFF121212);
  static const Color _darkSurface = Color(0xFF1E1E1E);
  static const Color _darkBorder = Color(0xFF424242);
  static const Color _darkError = Color(0xFFEF5350);
  static const Color _darkText = Color(0xFFFFFFFF);
  static const Color _darkTextSecondary = Color(0xFFB0B0B0);

  static Color get lightPrimary => _lightPrimary;
  static Color get lightSecondary => _lightSecondary;
  static Color get lightNavy => _lightNavy;
  static Color get lightBackground => _lightBackground;
  static Color get lightSurface => _lightSurface;
  static Color get lightBorder => _lightBorder;
  static Color get lightError => _lightError;
  static Color get lightText => _lightText;
  static Color get lightTextSecondary => _lightTextSecondary;

  static Color get darkPrimary => _darkPrimary;
  static Color get darkSecondary => _darkSecondary;
  static Color get darkNavy => _darkNavy;
  static Color get darkBackground => _darkBackground;
  static Color get darkSurface => _darkSurface;
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
