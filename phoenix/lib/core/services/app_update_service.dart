import 'package:url_launcher/url_launcher.dart';

import 'package:phoenix/core/services/logger_service.dart';
import 'package:phoenix/core/services/remote_config_service.dart';
import 'package:phoenix/core/services/storage_service.dart';
import 'package:phoenix/core/utils/app_version.dart';

enum AppUpdateStatus { none, optional, mandatory }

// The update checker. Deliberately UI-free - a widget in the startup flow
// calls [checkForUpdate] once and shows a dialog only for `optional` /
// `mandatory`.
//
// Two independent "at most once per 24h" guards:
//   1. this class records the last check time in local storage and returns
//      `none` immediately (NO Remote Config fetch) when < 24h have passed;
//   2. Remote Config's own `minimumFetchInterval` (24h) means even the fetch
//      inside [refresh] won't touch the network more than once a day.
class AppUpdateService {
  AppUpdateService({
    required RemoteConfigService remoteConfigService,
    required StorageService storageService,
    required String currentVersion,
    Duration checkInterval = const Duration(hours: 24),
    DateTime Function()? now,
  }) : _remoteConfig = remoteConfigService,
       _storage = storageService,
       _currentVersion = currentVersion,
       _checkInterval = checkInterval,
       _now = now ?? DateTime.now;

  static const _lastCheckKey = 'app_update.last_check_at';

  final RemoteConfigService _remoteConfig;
  final StorageService _storage;
  final String _currentVersion;
  final Duration _checkInterval;
  final DateTime Function() _now;
  final _logger = LoggerService();

  DateTime? _lastCheck() {
    final raw = _storage.getString(_lastCheckKey);
    return raw == null ? null : DateTime.tryParse(raw);
  }

  bool get _dueForCheck {
    final last = _lastCheck();
    return last == null || _now().difference(last) >= _checkInterval;
  }

  /// The whole flow from the requirement's diagram. Never throws.
  ///
  ///   < 24h since last check           -> none  (and no fetch at all)
  ///   >= 24h -> fetch, then:
  ///     current < min_version          -> mandatory
  ///     current < latest_version       -> optional
  ///     otherwise                      -> none
  Future<AppUpdateStatus> checkForUpdate() async {
    try {
      if (!_dueForCheck) return AppUpdateStatus.none;

      // Record the attempt up front, so a fetch that fails (offline, plugin
      // error) still counts as "checked" and we don't retry every launch -
      // "at most once every 24 hours" applies to failures too.
      await _storage.setString(_lastCheckKey, _now().toIso8601String());

      await _remoteConfig.refresh();
      return _evaluate();
    } catch (e) {
      _logger.info('AppUpdateService.checkForUpdate skipped: $e');
      return AppUpdateStatus.none;
    }
  }

  AppUpdateStatus _evaluate() {
    // Can't read our own version -> can't compare -> show nothing.
    if (AppVersion.parse(_currentVersion) == null) return AppUpdateStatus.none;

    final minVersion = _remoteConfig.minVersion;
    final latestVersion = _remoteConfig.latestVersion;

    if (AppVersion.isLessThan(_currentVersion, minVersion)) {
      return AppUpdateStatus.mandatory;
    }
    if (AppVersion.isLessThan(_currentVersion, latestVersion)) {
      return AppUpdateStatus.optional;
    }
    return AppUpdateStatus.none;
  }

  /// Opens the store page from `update_url`. Returns false (never throws) when
  /// the url is missing/invalid or the launch fails - the dialog then shows a
  /// localized retry message and stays open.
  Future<bool> openUpdateUrl() async {
    try {
      final raw = _remoteConfig.updateUrl.trim();
      if (raw.isEmpty) return false;
      final uri = Uri.tryParse(raw);
      if (uri == null || !uri.hasScheme || !uri.hasAuthority) return false;
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      _logger.info('AppUpdateService.openUpdateUrl failed: $e');
      return false;
    }
  }
}
