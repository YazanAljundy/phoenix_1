import 'package:firebase_remote_config/firebase_remote_config.dart';

// Thin wrapper around Firebase Remote Config for the app-update checker.
//
// The only three parameters Phoenix reads from Remote Config:
//   latest_version  - newest published version, e.g. "1.2.0"
//   min_version     - oldest version still supported, e.g. "1.1.0"
//   update_url      - store page to send the user to
//
// Every Firebase call here is wrapped so Remote Config can never stop Phoenix
// from starting: a missing Firebase project, no network, a plugin error - all
// resolve to "we simply have no update info", which the caller treats as
// "do nothing".
class RemoteConfigService {
  RemoteConfigService();

  static const keyLatestVersion = 'latest_version';
  static const keyMinVersion = 'min_version';
  static const keyUpdateUrl = 'update_url';

  // Safe defaults. "0.0.0" guarantees NO update dialog when Remote Config is
  // unreachable and we never got real values - the current app version is
  // always >= 0.0.0, so both the mandatory and optional checks fail closed.
  static const Map<String, Object> _defaults = {
    keyLatestVersion: '0.0.0',
    keyMinVersion: '0.0.0',
    keyUpdateUrl: '',
  };

  // Lazy, like FcmService's `_messaging` - touching FirebaseRemoteConfig.instance
  // throws if Firebase hasn't initialised yet, and this class is constructed in
  // main() / in tests where that isn't guaranteed.
  FirebaseRemoteConfig get _rc => FirebaseRemoteConfig.instance;

  bool _initialised = false;

  /// Sets the fetch settings + defaults and activates any values fetched on a
  /// previous run. Does NOT hit the network (no fetch here) - that only
  /// happens in [refresh], and only after the caller's own 24h gate.
  Future<void> initialize() async {
    try {
      await _rc.setConfigSettings(
        RemoteConfigSettings(
          fetchTimeout: const Duration(seconds: 10),
          minimumFetchInterval: const Duration(hours: 24),
        ),
      );
      await _rc.setDefaults(_defaults);
      // Apply values fetched during an earlier session, if any. Offline-safe.
      await _rc.activate();
      _initialised = true;
    } catch (_) {
      // Remote Config unavailable - Phoenix continues. `refresh` and the
      // getters below will just return the compiled-in defaults.
    }
  }

  /// Fetches fresh values and activates them. Firebase's own
  /// `minimumFetchInterval` (24h, set in [initialize]) means this is a no-op
  /// on the network when it was last fetched under 24h ago. Never throws.
  Future<void> refresh() async {
    try {
      if (!_initialised) await initialize();
      await _rc.fetchAndActivate();
    } catch (_) {
      // Keep whatever values we already have (fetched earlier, or defaults).
    }
  }

  String _string(String key) {
    try {
      final value = _rc.getString(key);
      return value.isNotEmpty ? value : (_defaults[key] as String? ?? '');
    } catch (_) {
      return _defaults[key] as String? ?? '';
    }
  }

  String get latestVersion => _string(keyLatestVersion);
  String get minVersion => _string(keyMinVersion);
  String get updateUrl => _string(keyUpdateUrl);
}
