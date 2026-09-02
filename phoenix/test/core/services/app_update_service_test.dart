import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:phoenix/core/services/app_update_service.dart';
import 'package:phoenix/core/services/remote_config_service.dart';
import 'package:phoenix/core/services/storage_service.dart';

class MockRemoteConfigService extends Mock implements RemoteConfigService {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late MockRemoteConfigService rc;
  late StorageService storage;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    storage = StorageService(await SharedPreferences.getInstance());
    rc = MockRemoteConfigService();
    when(() => rc.refresh()).thenAnswer((_) async {});
    when(() => rc.updateUrl).thenReturn('https://play.google.com/store/apps/details?id=phoenix');
  });

  AppUpdateService build({
    required String current,
    String latest = '1.0.0',
    String min = '1.0.0',
    DateTime Function()? now,
    Duration interval = const Duration(hours: 24),
  }) {
    when(() => rc.latestVersion).thenReturn(latest);
    when(() => rc.minVersion).thenReturn(min);
    return AppUpdateService(
      remoteConfigService: rc,
      storageService: storage,
      currentVersion: current,
      checkInterval: interval,
      now: now,
    );
  }

  group('status evaluation (spec section 14)', () {
    test('1. current == latest -> none', () async {
      final s = build(current: '1.2.0', latest: '1.2.0', min: '1.1.0');
      expect(await s.checkForUpdate(), AppUpdateStatus.none);
    });

    test('2. current > latest -> none', () async {
      final s = build(current: '1.3.0', latest: '1.2.0', min: '1.1.0');
      expect(await s.checkForUpdate(), AppUpdateStatus.none);
    });

    test('3. current < latest AND current >= min -> optional', () async {
      final s = build(current: '1.1.0', latest: '1.2.0', min: '1.1.0');
      expect(await s.checkForUpdate(), AppUpdateStatus.optional);
    });

    test('3b. optional also when current is between min and latest', () async {
      final s = build(current: '1.1.5', latest: '1.2.0', min: '1.1.0');
      expect(await s.checkForUpdate(), AppUpdateStatus.optional);
    });

    test('4. current < min -> mandatory', () async {
      final s = build(current: '1.0.9', latest: '1.2.0', min: '1.1.0');
      expect(await s.checkForUpdate(), AppUpdateStatus.mandatory);
    });

    test('4b. mandatory wins even when current is also below latest', () async {
      final s = build(current: '1.0.0', latest: '2.0.0', min: '1.5.0');
      expect(await s.checkForUpdate(), AppUpdateStatus.mandatory);
    });

    test('5. numeric compare: 1.0.10 is NOT below 1.0.9 -> none', () async {
      final s = build(current: '1.0.10', latest: '1.0.9', min: '1.0.0');
      expect(await s.checkForUpdate(), AppUpdateStatus.none);
    });

    test('6. an invalid current version never crashes -> none', () async {
      expect(await build(current: '').checkForUpdate(), AppUpdateStatus.none);
      SharedPreferences.setMockInitialValues({});
      storage = StorageService(await SharedPreferences.getInstance());
      expect(await build(current: 'not-a-version', latest: '9.9.9').checkForUpdate(),
          AppUpdateStatus.none);
    });

    test('6b. an invalid Remote Config version never crashes -> none', () async {
      final s = build(current: '1.0.0', latest: 'garbage', min: 'also-garbage');
      expect(await s.checkForUpdate(), AppUpdateStatus.none);
    });

    test('7. a Remote Config failure -> none, no throw', () async {
      when(() => rc.refresh()).thenThrow(Exception('firebase unavailable'));
      when(() => rc.latestVersion).thenThrow(Exception('firebase unavailable'));
      when(() => rc.minVersion).thenThrow(Exception('firebase unavailable'));
      final s = AppUpdateService(
        remoteConfigService: rc,
        storageService: storage,
        currentVersion: '1.0.0',
      );
      expect(await s.checkForUpdate(), AppUpdateStatus.none);
    });
  });

  group('24-hour gate (spec section 2)', () {
    test('first launch: fetches Remote Config and records the check time', () async {
      final t0 = DateTime(2026, 1, 1, 8);
      final s = build(current: '1.1.0', latest: '1.2.0', min: '1.1.0', now: () => t0);

      final status = await s.checkForUpdate();

      expect(status, AppUpdateStatus.optional);
      verify(() => rc.refresh()).called(1);
      expect(storage.getString('app_update.last_check_at'), t0.toIso8601String());
    });

    test('relaunch after 2h / 10h / 23h: NO fresh fetch, returns none', () async {
      final t0 = DateTime(2026, 1, 1, 8);
      await build(current: '1.1.0', latest: '1.2.0', now: () => t0).checkForUpdate();
      clearInteractions(rc);

      for (final hours in [2, 10, 23]) {
        final later = t0.add(Duration(hours: hours));
        final status = await build(
          current: '1.1.0',
          latest: '1.2.0',
          now: () => later,
        ).checkForUpdate();

        expect(status, AppUpdateStatus.none, reason: 'launch after ${hours}h');
        verifyNever(() => rc.refresh());
      }
    });

    test('relaunch after 24h+: a fresh fetch is allowed again', () async {
      final t0 = DateTime(2026, 1, 1, 8);
      await build(current: '1.1.0', latest: '1.2.0', now: () => t0).checkForUpdate();
      clearInteractions(rc);

      final next = t0.add(const Duration(hours: 25));
      final status = await build(
        current: '1.1.0',
        latest: '1.2.0',
        min: '1.1.0',
        now: () => next,
      ).checkForUpdate();

      expect(status, AppUpdateStatus.optional);
      verify(() => rc.refresh()).called(1);
    });

    test('a failed fetch still counts as a check (no retry storm)', () async {
      final t0 = DateTime(2026, 1, 1, 8);
      when(() => rc.refresh()).thenThrow(Exception('offline'));

      await build(current: '1.1.0', now: () => t0).checkForUpdate();
      clearInteractions(rc);
      when(() => rc.refresh()).thenThrow(Exception('offline'));

      final soon = t0.add(const Duration(hours: 3));
      await build(current: '1.1.0', now: () => soon).checkForUpdate();
      verifyNever(() => rc.refresh());
    });
  });

  group('openUpdateUrl', () {
    test('returns false (no throw) when update_url is empty or invalid', () async {
      when(() => rc.updateUrl).thenReturn('');
      expect(await build(current: '1.0.0').openUpdateUrl(), isFalse);

      when(() => rc.updateUrl).thenReturn('not a url');
      expect(await build(current: '1.0.0').openUpdateUrl(), isFalse);
    });
  });
}
