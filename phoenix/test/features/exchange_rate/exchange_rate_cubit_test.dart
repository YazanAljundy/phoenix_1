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
}
