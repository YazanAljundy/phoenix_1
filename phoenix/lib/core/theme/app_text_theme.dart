import 'package:flutter/material.dart';

class AppTextTheme {
  const AppTextTheme._();

  static TextTheme light() => const TextTheme(
    displaySmall: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
    titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
    titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
    bodyLarge: TextStyle(fontSize: 16),
    bodyMedium: TextStyle(fontSize: 14),
    labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
  );

  static TextTheme dark() => light().copyWith(
    bodyLarge: light().bodyLarge!.copyWith(color: Colors.white),
    bodyMedium: light().bodyMedium!.copyWith(color: Colors.white70),
    titleLarge: light().titleLarge!.copyWith(color: Colors.white),
    titleMedium: light().titleMedium!.copyWith(color: Colors.white),
    displaySmall: light().displaySmall!.copyWith(color: Colors.white),
  );
}
