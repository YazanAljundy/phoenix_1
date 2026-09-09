import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../constants/app_padding.dart';
import '../constants/app_radius.dart';
import 'app_text_theme.dart';

class LightTheme {
  const LightTheme._();

  static ThemeData get data => ThemeData(
    useMaterial3: true,
    // Catch-all: TextTheme below covers the eight roles the app styles
    // itself, but Material composes plenty of text from its own defaults
    // (menu entries, tooltips, date pickers). Setting the family here means
    // none of those silently fall back to the OS's default Arabic face.
    fontFamily: AppTextTheme.fontFamily,
    // Explicit, not ColorScheme.fromSeed - Section 5's five brand colors are
    // exact values the app is required to use, not a seed for Material 3 to
    // algorithmically approximate into secondary/tertiary/etc.
    colorScheme: ColorScheme.light(
      primary: AppColors.lightPrimary,
      onPrimary: Colors.white,
      secondary: AppColors.lightSecondary,
      onSecondary: Colors.white,
      error: AppColors.lightError,
      onError: Colors.white,
      surface: AppColors.lightBackground,
      onSurface: AppColors.lightText,
    ),
    scaffoldBackgroundColor: AppColors.lightBackground,
    textTheme: AppTextTheme.light(),
    appBarTheme: AppBarTheme(
      backgroundColor: AppColors.lightNavy,
      foregroundColor: Colors.white,
      elevation: 2,
      shadowColor: Colors.black.withValues(alpha: 0.15),
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
      titleTextStyle: AppTextTheme.style(fontSize: 20, fontWeight: AppTextTheme.bold, color: Colors.white),
    ),
    cardTheme: CardThemeData(
      color: AppColors.lightSurfaceElevated,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.large,
        side: BorderSide(color: AppColors.lightBorder),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.lightSurface,
      contentPadding: AppPadding.input,
      border: OutlineInputBorder(
        borderRadius: AppRadius.small,
        borderSide: BorderSide(color: AppColors.lightBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: AppRadius.small,
        borderSide: BorderSide(color: AppColors.lightBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: AppRadius.small,
        borderSide: BorderSide(color: AppColors.lightPrimary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: AppRadius.small,
        borderSide: BorderSide(color: AppColors.lightError),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: AppRadius.small,
        borderSide: BorderSide(color: AppColors.lightError, width: 1.5),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 65,
      backgroundColor: AppColors.lightSurfaceElevated,
      indicatorColor: AppColors.lightPrimary.withValues(alpha: 0.15),
      indicatorShape: const StadiumBorder(),
      // 10, not 11: the longest label ("سجل الحسابات" / "Account History")
      // measures ~78pt at 11 and a fifth of a 360dp phone is only ~72pt, so at
      // 11 it could not fit the one line the icon alignment depends on. At 10
      // it lands around 70pt and every label still fits without ellipsis.
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => AppTextTheme.style(
          fontSize: 10,
          fontWeight: states.contains(WidgetState.selected) ? AppTextTheme.semiBold : AppTextTheme.medium,
          color: states.contains(WidgetState.selected) ? AppColors.lightPrimary : AppColors.lightTextSecondary,
        ),
      ),
    ),
  );
}
