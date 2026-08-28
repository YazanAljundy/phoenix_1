import 'package:shared_preferences/shared_preferences.dart';

class StorageService {
  StorageService(this._prefs);

  final SharedPreferences _prefs;

  Future<bool> setString(String key, String value) async =>
      _prefs.setString(key, value);

  String? getString(String key) => _prefs.getString(key);

  Future<bool> remove(String key) async => _prefs.remove(key);

  /// Discard the in-memory cache and re-read from disk. Needed to see writes
  /// made by another isolate - the FCM background handler saves notifications
  /// this way (see NotificationRepository).
  Future<void> reload() => _prefs.reload();
}
