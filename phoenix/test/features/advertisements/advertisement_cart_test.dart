import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/features/advertisements/data/models/advertisement_cart_preparation.dart';
import 'package:feniq/features/advertisements/data/models/advertisement_model.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';

class MockOrderRepository extends Mock implements OrderRepository {}

class MockWarehouseRepository extends Mock implements WarehouseRepository {}

// A package carries no per-product price: the server sends each product's
// catalog price as `priceUsd` AND as `discountPriceUsd` (the cart's line
// price), plus a `quantity`, and the package total is the discount. Default
// package: p1x2 @30, p2x1 @25, p3x1 @12 -> weighted catalog sum 97, total 60.
Map<String, dynamic> _cartJson({
  String advertisementId = 'ad1',
  String warehouseId = 'A',
  num totalPriceUsd = 60,
  List<Map<String, dynamic>>? unavailableItems,
}) => {
  'advertisementId': advertisementId,
  'titleAr': 'باقة',
  'titleEn': 'Package',
  'warehouseId': warehouseId,
  'warehouseNameAr': 'مستودع',
  'warehouseNameEn': 'Warehouse A',
  'totalPriceUsd': totalPriceUsd,
  'itemsTotalUsd': 97, // 2x30 + 25 + 12
  'items': [
    _itemJson('p1', 30, 2),
    _itemJson('p2', 25, 1),
    _itemJson('p3', 12, 1),
  ],
  'unavailableItems': unavailableItems ?? const [],
};

Map<String, dynamic> _itemJson(String id, num priceUsd, int quantity) => {
  'id': id,
  'nameAr': 'دواء $id',
  'nameEn': 'Product $id',
  'manufacturerAr': 'شركة',
  'manufacturerEn': 'Pharma',
  'priceUsd': priceUsd,
  // The catalog price is also the cart's line price - CartItem.fromProduct
  // reads discountPriceUsd, and the package total is the one order-level
  // discount.
  'discountPriceUsd': priceUsd,
  'quantity': quantity,
  'isAvailable': true,
  'offer': null,
};

ProductModel _product(String id) => ProductModel(
  id: id,
  nameAr: 'دواء $id',
  manufacturerAr: 'شركة',
  priceUsd: 10,
  discountPriceUsd: 10,
  isAvailable: true,
  hasActiveOffer: false,
);

const _fakeOrder = OrderModel(
  id: 'o1',
  orderNumber: 1,
  status: 'pending',
  totalPrice: 0,
  discountAmount: 0,
  commissionAmount: 0,
  finalPrice: 0,
);

void main() {
  setUpAll(() => registerFallbackValue(<CartItem>[]));

  late MockOrderRepository orderRepo;
  late MockWarehouseRepository warehouseRepo;
  late CartCubit cubit;

  setUp(() {
    orderRepo = MockOrderRepository();
    warehouseRepo = MockWarehouseRepository();
    when(
      () => warehouseRepo.getWarehouseProfile(any()),
    ).thenAnswer((_) async => throw Exception('limits fetch not exercised here'));
    cubit = CartCubit(orderRepository: orderRepo, warehouseRepository: warehouseRepo);
  });

  tearDown(() => cubit.close());

  // A package goes into the cart as ONE line whose quantity is the number of
  // copies, priced at the package total. Its products are not cart lines.
  void addPackage({String warehouseId = 'A', num totalPriceUsd = 60, int copies = 1}) {
    final preparation = AdvertisementCartPreparation.fromJson(
      _cartJson(warehouseId: warehouseId, totalPriceUsd: totalPriceUsd),
    );
    cubit.addPackage(
      preparation.toCartLine(isArabic: false, copies: copies),
      warehouseId: preparation.warehouseId,
      warehouseName: preparation.warehouseNameEn ?? preparation.warehouseNameAr,
    );
  }

  group('parsing the server cart payload', () {
    test('the payload becomes package contents, not cart lines', () {
      final preparation = AdvertisementCartPreparation.fromJson(_cartJson());

      expect(preparation.contents.length, 3);
      expect(preparation.contents.map((c) => c.quantityPerCopy).toList(), [2, 1, 1]);
      expect(preparation.contents.map((c) => c.productId).toList(), ['p1', 'p2', 'p3']);
      expect(preparation.totalPriceUsd, 60);
      expect(preparation.itemsTotalUsd, 97);
      expect(preparation.isComplete, isTrue);
    });

    test('the cart line is the package itself, priced at the package total', () {
      final line = AdvertisementCartPreparation.fromJson(_cartJson())
          .toCartLine(isArabic: false);

      expect(line.isPackage, isTrue);
      expect(line.packageId, 'ad1');
      expect(line.lineKey, 'ad1');
      expect(line.discountPriceUsd, 60, reason: 'one copy of the package');
      expect(line.quantity, 1, reason: 'quantity is a copy count');
      expect(line.lineTotalUsd, 60);
      expect(line.packageContents.length, 3);
      // A package has no struck-through "was" price - its price IS the offer.
      expect(line.hasOffer, isFalse);
    });

    test('a package missing one of its products is not complete', () {
      final preparation = AdvertisementCartPreparation.fromJson(
        _cartJson(
          unavailableItems: [
            {'productId': 'p9', 'productNameAr': 'x', 'productNameEn': 'Gone', 'quantity': 1},
          ],
        ),
      );
      expect(preparation.isComplete, isFalse);
      expect(preparation.unavailableItems.single.productNameEn, 'Gone');
    });

    test('a deleted product with no name at all still parses', () {
      final preparation = AdvertisementCartPreparation.fromJson(
        _cartJson(
          unavailableItems: [
            {'productId': 'p9', 'productNameAr': null, 'productNameEn': null, 'quantity': 1},
          ],
        ),
      );
      expect(preparation.unavailableItems.single.productNameAr, '');
    });
  });

  group('a package in the cart', () {
    test('is a single line, bound to its warehouse', () {
      expect(cubit.state.isEmpty, isTrue);

      addPackage();

      expect(cubit.state.items.length, 1);
      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.items.single.packageId, 'ad1');
      expect(cubit.state.hasPackage, isTrue);
    });

    test('the cart badge counts it once, whatever it contains', () {
      addPackage();
      expect(cubit.state.itemCount, 1);

      // Three copies of a three-product package is still ONE thing in the cart.
      cubit.updateQuantity('ad1', 3);
      expect(cubit.state.itemCount, 1);

      cubit.addProduct(_product('extra'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 7);
      expect(cubit.state.itemCount, 2, reason: 'one package line + one product line');
    });

    test('the package price is what is charged, not the catalog sum', () {
      addPackage();

      expect(cubit.state.subtotalUsd, 60);
      expect(cubit.state.payableUsd, 60);
    });

    test('adding the same package again bumps its copies, not a second line', () {
      addPackage();
      addPackage();

      expect(cubit.state.items.length, 1);
      expect(cubit.state.items.single.quantity, 2);
      expect(cubit.state.subtotalUsd, 120);
    });

    test('two different packages are two lines', () {
      addPackage();
      final other = AdvertisementCartPreparation.fromJson(
        _cartJson(advertisementId: 'ad2', totalPriceUsd: 15),
      );
      cubit.addPackage(
        other.toCartLine(isArabic: false),
        warehouseId: 'A',
        warehouseName: 'Warehouse A',
      );

      expect(cubit.state.items.length, 2);
      expect(cubit.state.itemCount, 2);
      expect(cubit.state.subtotalUsd, 75);
    });

    test('hasConflictingWarehouse still reports a cross-warehouse package cart', () {
      addPackage();

      expect(cubit.hasConflictingWarehouse('B'), isTrue);
      expect(cubit.hasConflictingWarehouse('A'), isFalse);
    });

    test('replaceWithPackage clears a cart from another warehouse', () {
      cubit.addProduct(_product('other'), warehouseId: 'B', warehouseName: 'Warehouse B', quantity: 1);
      final preparation = AdvertisementCartPreparation.fromJson(_cartJson());

      cubit.replaceWithPackage(
        preparation.toCartLine(isArabic: false),
        warehouseId: 'A',
        warehouseName: 'Warehouse A',
      );

      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.items.length, 1);
      expect(cubit.state.items.single.packageId, 'ad1');
    });
  });

  group('changing how many copies', () {
    test('the stepper drives the copy count and the line total', () {
      addPackage();

      cubit.updateQuantity('ad1', 3);

      expect(cubit.state.items.single.quantity, 3);
      expect(cubit.state.items.single.lineTotalUsd, 180);
      expect(cubit.state.payableUsd, 180);
    });

    test('the contents scale with the copies for display', () {
      addPackage(copies: 2);

      final line = cubit.state.items.single;
      // p1 is 2 per copy, so 2 copies deliver 4.
      expect(line.packageContents.first.quantityPerCopy * line.quantity, 4);
    });

    test('a package alongside products keeps both priced independently', () {
      addPackage();
      cubit.addProduct(_product('extra'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);

      expect(cubit.state.items.length, 2);
      expect(cubit.state.subtotalUsd, 80, reason: '60 package + 2 x 10');
      expect(cubit.state.payableUsd, 80);
    });

    test('removing the package leaves the rest of the cart alone', () {
      addPackage();
      cubit.addProduct(_product('extra'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);

      cubit.removeItem('ad1');

      expect(cubit.state.hasPackage, isFalse);
      expect(cubit.state.items.single.productId, 'extra');
      expect(cubit.state.subtotalUsd, 10);
    });

    test('removing the last line resets the cart completely', () {
      addPackage();
      cubit.removeItem('ad1');

      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.warehouseId, isNull);
    });
  });

  group('checkout', () {
    void stubSubmit() {
      when(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          idempotencyKey: any(named: 'idempotencyKey'),
          rateUsed: any(named: 'rateUsed'),
        ),
      ).thenAnswer((_) async => _fakeOrder);
    }

    List<CartItem> capturedItems() => verify(
          () => orderRepo.submitOrder(
            warehouseId: any(named: 'warehouseId'),
            items: captureAny(named: 'items'),
            notes: any(named: 'notes'),
            idempotencyKey: any(named: 'idempotencyKey'),
            rateUsed: any(named: 'rateUsed'),
          ),
        ).captured.single as List<CartItem>;

    test('the package crosses as a line the repository can split out', () async {
      stubSubmit();
      addPackage(copies: 2);
      await cubit.submitOrder();

      final items = capturedItems();
      expect(items.length, 1);
      expect(items.single.isPackage, isTrue);
      expect(items.single.packageId, 'ad1');
      expect(items.single.quantity, 2, reason: 'copies');
    });

    test('a mixed cart carries both kinds of line', () async {
      stubSubmit();
      addPackage();
      cubit.addProduct(_product('extra'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 3);
      await cubit.submitOrder();

      final items = capturedItems();
      expect(items.where((i) => i.isPackage).length, 1);
      expect(items.where((i) => !i.isPackage).length, 1);
    });
  });

  group('a package that is no longer available', () {
    void stubCheckoutFailure(ServerFailure failure) {
      when(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          idempotencyKey: any(named: 'idempotencyKey'),
          rateUsed: any(named: 'rateUsed'),
        ),
      ).thenThrow(failure);
    }

    test('the server flag is parsed, and a missing flag means available', () {
      expect(AdvertisementCartPreparation.fromJson(_cartJson()).isAvailable, isTrue);

      final paused = AdvertisementCartPreparation.fromJson({..._cartJson(), 'isAvailable': false});
      expect(paused.isAvailable, isFalse);
      expect(paused.toCartLine(isArabic: false).isAvailable, isFalse);
    });

    test('a PACKAGE_UNAVAILABLE refusal flags exactly the refused package line', () async {
      addPackage();
      cubit.addProduct(_product('loose'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      stubCheckoutFailure(
        ServerFailure(
          'This package is no longer available.',
          code: 'PACKAGE_UNAVAILABLE',
          details: {
            'advertisementIds': ['ad1'],
          },
        ),
      );

      final order = await cubit.submitOrder();

      expect(order, isNull);
      expect(cubit.state.errorCode, 'PACKAGE_UNAVAILABLE');
      expect(cubit.state.isSubmitting, isFalse);
      expect(cubit.state.items.length, 2, reason: 'nothing is dropped without the pharmacist choosing to');
      expect(cubit.state.items.firstWhere((item) => item.isPackage).isAvailable, isFalse);
      expect(cubit.state.items.firstWhere((item) => !item.isPackage).isAvailable, isTrue);
    });

    test('any other checkout failure flags nothing', () async {
      addPackage();
      stubCheckoutFailure(ServerFailure('Out of stock.', code: 'STOCK_CHECK_FAILED'));

      await cubit.submitOrder();

      expect(cubit.state.items.single.isAvailable, isTrue);
    });

    test('removing unavailable packages keeps the rest of the cart', () {
      addPackage();
      cubit.addProduct(_product('loose'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.markPackagesUnavailable(['ad1']);

      cubit.removeUnavailablePackages();

      expect(cubit.state.items.map((item) => item.lineKey).toList(), ['loose']);
      expect(cubit.state.warehouseId, 'A');
    });

    test('removing the only, unavailable package resets the cart', () {
      addPackage();
      cubit.markPackagesUnavailable(['ad1']);

      cubit.removeUnavailablePackages();

      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.warehouseId, isNull);
    });

    test('the flag survives a change of copies', () {
      addPackage();
      cubit.markPackagesUnavailable(['ad1']);

      cubit.updateQuantity('ad1', 3);

      expect(cubit.state.items.single.isAvailable, isFalse);
      expect(cubit.state.items.single.quantity, 3);
    });

    test('flagging a package that is not in the cart changes nothing', () {
      addPackage();
      final before = cubit.state;

      cubit.markPackagesUnavailable(['someone-else']);

      expect(identical(cubit.state, before), isTrue);
    });
  });

  group('a normal cart is completely unaffected', () {
    test('no package means payable == subtotal', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);

      expect(cubit.state.hasPackage, isFalse);
      expect(cubit.state.subtotalUsd, 20);
      expect(cubit.state.payableUsd, 20);
      expect(cubit.state.items.single.isPackage, isFalse);
    });
  });

  group('the active-advertisement list model', () {
    test('carries the catalog price + quantity per item and the server saving %', () {
      final advertisement = AdvertisementModel.fromJson({
        'id': 'ad1',
        'titleAr': 'باقة',
        'titleEn': 'Package',
        'warehouseId': 'A',
        'warehouseNameAr': 'مستودع',
        'warehouseNameEn': 'Warehouse A',
        'items': [
          {'productId': 'p1', 'nameAr': 'د', 'nameEn': 'P1', 'priceUsd': 30, 'quantity': 3, 'isAvailable': true},
        ],
        'itemsTotalUsd': 90,
        'totalPriceUsd': 60,
        'savingPercentage': 33,
      });

      expect(advertisement.savingUsd, 30);
      expect(advertisement.savingPercentage, 33);
      expect(advertisement.hasSaving, isTrue);
      expect(advertisement.items.single.priceUsd, 30);
      expect(advertisement.items.single.quantity, 3);
      expect(advertisement.items.single.lineTotalUsd, 90);
    });

    test('an item quantity defaults to 1 when the server omits it', () {
      final advertisement = AdvertisementModel.fromJson({
        'id': 'ad1',
        'titleAr': 'باقة',
        'warehouseId': 'A',
        'warehouseNameAr': 'مستودع',
        'items': [
          {'productId': 'p1', 'nameAr': 'د', 'priceUsd': 30, 'isAvailable': true},
        ],
        'itemsTotalUsd': 30,
        'totalPriceUsd': 25,
      });

      expect(advertisement.items.single.quantity, 1);
    });

    test('falls back to the local formula when the server omits saving %', () {
      final advertisement = AdvertisementModel.fromJson({
        'id': 'ad1',
        'titleAr': 'باقة',
        'warehouseId': 'A',
        'warehouseNameAr': 'مستودع',
        'items': const [],
        'itemsTotalUsd': 100,
        'totalPriceUsd': 75,
      });

      expect(advertisement.savingPercentage, 25);
    });

    test('a total at or above the catalog sum reports no saving', () {
      final advertisement = AdvertisementModel.fromJson({
        'id': 'ad1',
        'titleAr': 'باقة',
        'warehouseId': 'A',
        'warehouseNameAr': 'مستودع',
        'items': const [],
        'itemsTotalUsd': 40,
        'totalPriceUsd': 45,
        'savingPercentage': 0,
      });

      expect(advertisement.savingUsd, 0);
      expect(advertisement.savingPercentage, 0);
      expect(advertisement.hasSaving, isFalse);
    });
  });
}
