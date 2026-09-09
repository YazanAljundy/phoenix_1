import 'package:flutter/material.dart';

import '../constants/app_colors.dart';

// Tajawal: the FENIQ identity's type face, drawn for Arabic and Latin
// together, so the app's default language and its Latin numerals/brand words
// share one voice. Bundled from assets/fonts rather than fetched through
// google_fonts - the pharmacy app is used on flaky connections, and a
// runtime font download that fails silently falls back to whatever generic
// Arabic face the OS ships.
//
// Tajawal upstream has NO SemiBold/600 face (its ladder is 200/300/400/500/
// 700/800/900), so the four-tier hierarchy is realised as
// Regular 400 -> body, Medium 500 -> buttons and labels,
// Bold 700 -> subheadings, ExtraBold 800 -> headings and prices.
// Asking for w600 anywhere would land on a synthesised weight, so don't.
class AppTextTheme {
  const AppTextTheme._();

  static const String fontFamily = 'Tajawal';

  /// Body copy.
  static const FontWeight regular = FontWeight.w400;

  /// Buttons, inputs, form labels - anything interactive.
  static const FontWeight medium = FontWeight.w500;

  /// Subheadings. Stands in for the identity's "SemiBold" tier, which Tajawal
  /// does not ship.
  static const FontWeight semiBold = FontWeight.w700;

  /// Headings and prices.
  static const FontWeight bold = FontWeight.w800;

  static TextStyle style({
    required double fontSize,
    required FontWeight fontWeight,
    Color? color,
    double? height,
  }) => TextStyle(
    fontFamily: fontFamily,
    fontSize: fontSize,
    fontWeight: fontWeight,
    height: height,
    color: color,
  );

  static TextTheme _scale(Color primaryColor) => TextTheme(
    displaySmall: style(fontSize: 25, fontWeight: bold, height: 1.25, color: primaryColor),
    titleLarge: style(fontSize: 21, fontWeight: bold, color: primaryColor),
    titleMedium: style(fontSize: 16, fontWeight: semiBold, color: primaryColor),
    titleSmall: style(fontSize: 13, fontWeight: semiBold, color: primaryColor),
    bodyLarge: style(fontSize: 16, fontWeight: regular, color: primaryColor),
    bodyMedium: style(fontSize: 14, fontWeight: regular, color: primaryColor),
    bodySmall: style(fontSize: 12, fontWeight: regular, color: primaryColor),
    labelLarge: style(fontSize: 14, fontWeight: medium, color: primaryColor),
  );

  static TextTheme light() => _scale(AppColors.lightText);

  static TextTheme dark() => _scale(AppColors.darkText);
}
