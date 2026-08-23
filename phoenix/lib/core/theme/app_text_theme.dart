import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../constants/app_colors.dart';

// Cairo: chosen for the app's default (and primary) language, Arabic - unlike
// the previous Inter (Latin-only glyphs, silently falling back to whatever
// generic Arabic face the OS/browser happens to ship), Cairo is drawn for
// Arabic and Latin together, so both scripts share one consistent voice.
//
// Two roles previously missing here (titleSmall, bodySmall) were silently
// falling back to Flutter's stock Material type scale wherever used
// (request_return_sheet.dart's titleSmall, and bodySmall almost everywhere)
// - both are now explicit, in Cairo, like the rest.
class AppTextTheme {
  const AppTextTheme._();

  static TextTheme _scale(Color primaryColor) => TextTheme(
    displaySmall: GoogleFonts.cairo(fontSize: 25, fontWeight: FontWeight.w800, height: 1.25, color: primaryColor),
    titleLarge: GoogleFonts.cairo(fontSize: 21, fontWeight: FontWeight.w800, color: primaryColor),
    titleMedium: GoogleFonts.cairo(fontSize: 16, fontWeight: FontWeight.w700, color: primaryColor),
    titleSmall: GoogleFonts.cairo(fontSize: 13, fontWeight: FontWeight.w700, color: primaryColor),
    bodyLarge: GoogleFonts.cairo(fontSize: 16, fontWeight: FontWeight.w500, color: primaryColor),
    bodyMedium: GoogleFonts.cairo(fontSize: 14, fontWeight: FontWeight.w500, color: primaryColor),
    bodySmall: GoogleFonts.cairo(fontSize: 12, fontWeight: FontWeight.w500, color: primaryColor),
    labelLarge: GoogleFonts.cairo(fontSize: 14, fontWeight: FontWeight.w700, color: primaryColor),
  );

  static TextTheme light() => _scale(AppColors.lightText);

  static TextTheme dark() => _scale(AppColors.darkText);
}
