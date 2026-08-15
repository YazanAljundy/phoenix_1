import 'package:flutter/material.dart';
import 'package:phoenix/generated/app_localizations.dart';

extension BuildContextExtensions on BuildContext {
  ThemeData get theme => Theme.of(this);
  TextTheme get textTheme => theme.textTheme;
  ColorScheme get colorScheme => theme.colorScheme;

  double get screenWidth => MediaQuery.sizeOf(this).width;
  double get screenHeight => MediaQuery.sizeOf(this).height;
  bool get isDarkMode => theme.brightness == Brightness.dark;

  AppLocalizations get l10n => AppLocalizations.of(this)!;

  void pop() {
    Navigator.pop(this);
  }

  void unfocus() {
    FocusScope.of(this).unfocus();
  }
}
