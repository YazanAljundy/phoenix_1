import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:feniq/core/services/storage_service.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';

// Checkout deliberately does NOT re-read the exchange rate. The rate is kept
// current by the TTL plus the app-resume refresh (exchange_rate_cubit.dart),
// and a request on every submit would buy back only the seconds between the
// last refresh and the tap. What the cart sends is USD either way - the rate
// only decides the SYP figures on screen - so nothing about the order depends
// on it being re-read here.
//
// The cart files themselves are read-only for this branch; this test just
// drives them.

class _MockOrderRepository extends Mock implements OrderRepository {}

class _MockWarehouseRepository extends Mock implements WarehouseRepository {}

class _MockExchangeRateRepository extends Mock implements ExchangeRateRepository {}

ProductModel _product(String id) => ProductModel(
  id: id,
  nameAr: 'دواء $id',
  manufacturerAr: 'شركة',
  priceUsd: 10,
  discountPriceUsd: 10,
  isAvailable: true,
  hasActiveOffer: false,
);

const _order = OrderModel(
  id: 'o1',
  orderNumber: 1,
  status: 'pending',
  totalPrice: 0,
  discountAmount: 0,
  commissionAmount: 0,
  finalPrice: 0,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() => registerFallbackValue(<CartItem>[]));

  late _MockOrderRepository orderRepository;
  late _MockWarehouseRepository warehouseRepository;
  late _MockExchangeRateRepository rateRepository;

  setUp(() {
    orderRepository = _MockOrderRepository();
    warehouseRepository = _MockWarehouseRepository();
    rateRepository = _MockExchangeRateRepository();
    when(
      () => orderRepository.submitOrder(
        warehouseId: any(named: 'warehouseId'),
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    ).thenAnswer((_) async => _order);
    // The cart's own order-limits lookup; silent on failure by design.
    when(() => warehouseRepository.getWarehouseProfile(any()))
        .thenAnswer((_) async => throw Exception('not exercised here'));
  });

  Future<StorageService> storageWith(Map<String, Object> values) async {
    SharedPreferences.setMockInitialValues(values);
    return StorageService(await SharedPreferences.getInstance());
  }

  Future<void> submitACart() async {
    final cart = CartCubit(
      orderRepository: orderRepository,
      warehouseRepository: warehouseRepository,
    );
    cart.addProduct(_product('p1'), warehouseId: 'w1', warehouseName: 'W1', quantity: 2);
    final order = await cart.submitOrder();
    expect(order, isNotNull);
    await cart.close();
  }

  test('submitting an order reads the order endpoint and nothing else', () async {
    final clock = DateTime(2026, 9, 17, 9);
    final storage = await storageWith({
      kExchangeRateStorageKey: '15000.0',
      kExchangeRateFetchedAtStorageKey: clock.millisecondsSinceEpoch.toString(),
    });
    final rate = ExchangeRateCubit(
      exchangeRateRepository: rateRepository,
      storageService: storage,
      now: () => clock,
    );

    await submitACart();

    verify(
      () => orderRepository.submitOrder(
        warehouseId: any(named: 'warehouseId'),
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    ).called(1);
    verifyNever(() => rateRepository.getExchangeRate());
    expect(rate.state.usdToSyp, equals(15000.0));
    expect(rate.state.fetchedAt, equals(clock));
    await rate.close();
  });

  test('not even when the rate has expired - that is the accepted trade-off', () async {
    final fetchedAt = DateTime(2026, 9, 17, 9);
    var clock = fetchedAt;
    final storage = await storageWith({
      kExchangeRateStorageKey: '15000.0',
      kExchangeRateFetchedAtStorageKey: fetchedAt.millisecondsSinceEpoch.toString(),
    });
    final rate = ExchangeRateCubit(
      exchangeRateRepository: rateRepository,
      storageService: storage,
      now: () => clock,
    );
    clock = fetchedAt.add(kExchangeRateTtl * 3);
    expect(rate.isStale, isTrue);

    await submitACart();

    // Expired or not, checkout asks nobody: the refresh happens on resume,
    // not on the button.
    verifyNever(() => rateRepository.getExchangeRate());
    await rate.close();
  });
}
