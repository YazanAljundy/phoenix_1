import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:feniq/core/services/storage_service.dart';
import 'package:feniq/features/exchange_rate/data/models/exchange_rate_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

class _MockExchangeRateRepository extends Mock implements ExchangeRateRepository {}

// The rate is what turns the catalog's USD-stored prices into the SYP figures
// the pharmacist reads. Caching it is what keeps an offline launch showing
// prices in lira instead of currency_formatter.dart's kMoneyUnavailable dash.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _MockExchangeRateRepository repository;

  setUp(() {
    repository = _MockExchangeRateRepository();
  });

  Future<StorageService> storageWith(Map<String, Object> values) async {
    SharedPreferences.setMockInitialValues(values);
    return StorageService(await SharedPreferences.getInstance());
  }

  test('starts with no rate when nothing has ever been cached', () async {
    final storage = await storageWith({});

    final cubit = ExchangeRateCubit(
      exchangeRateRepository: repository,
      storageService: storage,
    );

    expect(cubit.state.usdToSyp, isNull);
  });

  test('seeds the initial state from the cached rate, before any fetch', () async {
    final storage = await storageWith({kExchangeRateStorageKey: '15000.0'});

    final cubit = ExchangeRateCubit(
      exchangeRateRepository: repository,
      storageService: storage,
    );

    expect(cubit.state.usdToSyp, equals(15000.0));
    verifyNever(() => repository.getExchangeRate());
  });

  test('ignores a corrupt or non-positive cached value', () async {
    expect(
      ExchangeRateCubit(
        exchangeRateRepository: repository,
        storageService: await storageWith({kExchangeRateStorageKey: 'not-a-number'}),
      ).state.usdToSyp,
      isNull,
    );
    expect(
      ExchangeRateCubit(
        exchangeRateRepository: repository,
        storageService: await storageWith({kExchangeRateStorageKey: '0'}),
      ).state.usdToSyp,
      isNull,
    );
  });

  test('a successful load emits the fresh rate and caches it', () async {
    final storage = await storageWith({});
    when(() => repository.getExchangeRate())
        .thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 12500));

    final cubit = ExchangeRateCubit(
      exchangeRateRepository: repository,
      storageService: storage,
    );
    await cubit.load();

    expect(cubit.state.usdToSyp, equals(12500));
    expect(storage.getString(kExchangeRateStorageKey), equals('12500.0'));
  });

  test('a failed load keeps the cached rate and never throws', () async {
    final storage = await storageWith({kExchangeRateStorageKey: '15000.0'});
    when(() => repository.getExchangeRate()).thenThrow(Exception('offline'));

    final cubit = ExchangeRateCubit(
      exchangeRateRepository: repository,
      storageService: storage,
    );
    await cubit.load();

    expect(cubit.state.usdToSyp, equals(15000.0));
    expect(storage.getString(kExchangeRateStorageKey), equals('15000.0'));
  });

  test('works without a storage service (the rate just is not remembered)', () async {
    when(() => repository.getExchangeRate())
        .thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 9000));

    final cubit = ExchangeRateCubit(exchangeRateRepository: repository);
    expect(cubit.state.usdToSyp, isNull);

    await cubit.load();
    expect(cubit.state.usdToSyp, equals(9000));
  });

  // A rate fetched once and kept forever is what let a phone that sat in the
  // background all morning show yesterday's SYP figures. The rate now carries
  // when it was read, and coming back to the foreground re-reads an expired
  // one.
  group('TTL and app-resume refresh', () {
    // A clock the test moves by hand, so no test waits on real time.
    DateTime clock = DateTime(2026, 9, 17, 9);

    ExchangeRateCubit cubitWith(StorageService? storage) => ExchangeRateCubit(
      exchangeRateRepository: repository,
      storageService: storage,
      now: () => clock,
    );

    setUp(() {
      clock = DateTime(2026, 9, 17, 9);
      when(() => repository.getExchangeRate())
          .thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 12500));
    });

    test('a successful fetch stamps and stores when it happened', () async {
      final storage = await storageWith({});
      final cubit = cubitWith(storage);

      await cubit.load();

      expect(cubit.state.fetchedAt, equals(clock));
      expect(
        storage.getString(kExchangeRateFetchedAtStorageKey),
        equals(clock.millisecondsSinceEpoch.toString()),
      );
      expect(cubit.isStale, isFalse);
      await cubit.close();
    });

    test('an expired rate is re-read on resume', () async {
      final fetchedAt = clock;
      final storage = await storageWith({
        kExchangeRateStorageKey: '15000.0',
        kExchangeRateFetchedAtStorageKey: fetchedAt.millisecondsSinceEpoch.toString(),
      });
      final cubit = cubitWith(storage);
      expect(cubit.state.usdToSyp, equals(15000.0));

      // The app spent the morning in the background.
      clock = fetchedAt.add(kExchangeRateTtl + const Duration(seconds: 1));
      expect(cubit.isStale, isTrue);
      await cubit.refreshIfStale();

      expect(cubit.state.usdToSyp, equals(12500));
      expect(cubit.state.fetchedAt, equals(clock));
      verify(() => repository.getExchangeRate()).called(1);
      await cubit.close();
    });

    test('a rate that is still current is NOT re-read on resume', () async {
      final fetchedAt = clock;
      final storage = await storageWith({
        kExchangeRateStorageKey: '15000.0',
        kExchangeRateFetchedAtStorageKey: fetchedAt.millisecondsSinceEpoch.toString(),
      });
      final cubit = cubitWith(storage);

      // A glance at another app and straight back.
      clock = fetchedAt.add(kExchangeRateTtl - const Duration(seconds: 1));
      expect(cubit.isStale, isFalse);
      await cubit.refreshIfStale();

      expect(cubit.state.usdToSyp, equals(15000.0));
      verifyNever(() => repository.getExchangeRate());
      await cubit.close();
    });

    test('with no rate at all, resume fetches whatever the TTL says', () async {
      final cubit = cubitWith(await storageWith({}));

      expect(cubit.isStale, isTrue);
      await cubit.refreshIfStale();

      // Screens were showing the "no rate" dash; that is worth a request at
      // the first opportunity.
      expect(cubit.state.usdToSyp, equals(12500));
      verify(() => repository.getExchangeRate()).called(1);
      await cubit.close();
    });

    test('a cached rate with no timestamp (an app updating from an older build) is stale', () async {
      final cubit = cubitWith(await storageWith({kExchangeRateStorageKey: '15000.0'}));

      expect(cubit.state.usdToSyp, equals(15000.0));
      expect(cubit.isStale, isTrue);
      await cubit.close();
    });

    test('a timestamp in the future (the device clock moved) is stale, not current forever', () async {
      final storage = await storageWith({
        kExchangeRateStorageKey: '15000.0',
        kExchangeRateFetchedAtStorageKey:
            clock.add(const Duration(days: 2)).millisecondsSinceEpoch.toString(),
      });
      final cubit = cubitWith(storage);

      expect(cubit.isStale, isTrue);
      await cubit.close();
    });

    test('two triggers at once make ONE request and share its answer', () async {
      final completer = Completer<ExchangeRateModel>();
      when(() => repository.getExchangeRate()).thenAnswer((_) => completer.future);
      final cubit = cubitWith(await storageWith({}));

      // The shell opening as the app resumes.
      final first = cubit.load();
      final second = cubit.refreshIfStale();
      completer.complete(const ExchangeRateModel(usdToSyp: 12500));
      await Future.wait([first, second]);

      verify(() => repository.getExchangeRate()).called(1);
      expect(cubit.state.usdToSyp, equals(12500));

      // ...and the guard clears, so a later expiry can still fetch.
      clock = clock.add(kExchangeRateTtl * 2);
      when(() => repository.getExchangeRate())
          .thenAnswer((_) async => const ExchangeRateModel(usdToSyp: 13000));
      await cubit.refreshIfStale();
      expect(cubit.state.usdToSyp, equals(13000));
      await cubit.close();
    });

    test('a failed refresh keeps the cached rate AND leaves it stale, so the next resume retries', () async {
      final fetchedAt = clock;
      final storage = await storageWith({
        kExchangeRateStorageKey: '15000.0',
        kExchangeRateFetchedAtStorageKey: fetchedAt.millisecondsSinceEpoch.toString(),
      });
      final cubit = cubitWith(storage);
      when(() => repository.getExchangeRate()).thenThrow(Exception('offline'));
      clock = fetchedAt.add(kExchangeRateTtl + const Duration(minutes: 1));

      await cubit.refreshIfStale();

      expect(cubit.state.usdToSyp, equals(15000.0));
      expect(cubit.state.fetchedAt, equals(fetchedAt));
      expect(cubit.isStale, isTrue);
      expect(
        storage.getString(kExchangeRateFetchedAtStorageKey),
        equals(fetchedAt.millisecondsSinceEpoch.toString()),
      );
      await cubit.close();
    });

    test('the warehouse screen still forces a read, expired or not', () async {
      final fetchedAt = clock;
      final storage = await storageWith({
        kExchangeRateStorageKey: '15000.0',
        kExchangeRateFetchedAtStorageKey: fetchedAt.millisecondsSinceEpoch.toString(),
      });
      final cubit = cubitWith(storage);

      // Well inside the TTL - load() is the "screen opened" path and is
      // deliberately unconditional, exactly as it was before the TTL existed.
      clock = fetchedAt.add(const Duration(seconds: 30));
      await cubit.load();

      expect(cubit.state.usdToSyp, equals(12500));
      verify(() => repository.getExchangeRate()).called(1);
      await cubit.close();
    });
  });
}
