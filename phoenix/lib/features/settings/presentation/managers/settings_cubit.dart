import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/services/storage_service.dart';

import 'settings_state.dart';

class SettingsCubit extends Cubit<SettingsState> {
  SettingsCubit({
    required StorageService storageService,
    SettingsState? initialState,
  }) : _storageService = storageService,
       super(initialState ?? const SettingsState());

  static const String _themeKey = 'settings.theme_mode';
  static const String _localeKey = 'settings.locale';

  final StorageService _storageService;

  Future<void> changeTheme(ThemeMode themeMode) async {
    emit(state.copyWith(themeMode: themeMode));
    await _persist();
  }

  Future<void> toggleTheme() async {
    emit(
      state.copyWith(
        themeMode: state.themeMode == ThemeMode.dark
            ? ThemeMode.light
            : ThemeMode.dark,
      ),
    );
    await _persist();
  }

  Future<void> changeLocale(Locale? locale) async {
    emit(state.copyWith(locale: locale, clearLocale: locale == null));
    await _persist();
  }

  Future<void> _persist() async {
    await _storageService.setString(_themeKey, state.themeMode.name);

    if (state.locale != null) {
      await _storageService.setString(_localeKey, state.locale!.languageCode);
    } else {
      await _storageService.remove(_localeKey);
    }
  }
}
