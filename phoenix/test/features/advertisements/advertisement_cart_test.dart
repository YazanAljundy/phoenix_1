import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/features/advertisements/data/models/advertisement_cart_preparation.dart';
import 'package:phoenix/features/advertisements/data/models/advertisement_model.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';

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

  void loadPackage({String warehouseId = 'A', num totalPriceUsd = 60}) {
    final preparation = AdvertisementCartPreparation.fromJson(
      _cartJson(warehouseId: warehouseId, totalPriceUsd: totalPriceUsd),
    );
    cubit.loadAdvertisement(
      advertisementId: preparation.advertisementId,
      warehouseId: preparation.warehouseId,
      warehouseName: preparation.warehouseNameEn ?? preparation.warehouseNameAr,
      items: preparation.items,
      itemsSubtotalUsd: preparation.itemsTotalUsd,
      totalUsd: preparation.totalPriceUsd,
    );
  }

  group('parsing the server cart payload', () {
    test('lines are priced at the catalog price and marked as a package', () {
      final preparation = AdvertisementCartPreparation.fromJson(_cartJson());

      expect(preparation.items.length, 3);
      // The catalog price is both the line price and the "unit" price.
      expect(preparation.items.map((i) => i.discountPriceUsd).toList(), [30, 25, 12]);
      expect(preparation.items.map((i) => i.unitPriceUsd).toList(), [30, 25, 12]);
      // The cart line quantity and the advertised minimum both come from the
      // payload's per-item quantity.
      expect(preparation.items.map((i) => i.quantity).toList(), [2, 1, 1]);
      expect(preparation.items.map((i) => i.advertisementQuantity).toList(), [2, 1, 1]);
      expect(preparation.items.every((i) => i.advertisementId == 'ad1'), isTrue);
      expect(preparation.items.every((i) => i.isAdvertised), isTrue);
      expect(preparation.totalPriceUsd, 60);
      expect(preparation.itemsTotalUsd, 97);
      expect(preparation.isComplete, isTrue);
    });

    test('a package missing one of its products is not complete', () {
      final preparation = AdvertisementCartPreparation.fromJson(
        _cartJson(
          unavailableItems: [
            {'productId': 'p9', 'productNameAr': 'دواء ناقص', 'productNameEn': 'Gone', 'quantity': 1},
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

  group('advertisement into the cart', () {
    test('an empty cart takes the package directly, bound to its warehouse', () {
      expect(cubit.state.isEmpty, isTrue);

      loadPackage();

      expect(cubit.state.items.length, 3);
      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.advertisementId, 'ad1');
      expect(cubit.state.hasAdvertisement, isTrue);
    });

    test('the package total is charged, not the quantity-weighted catalog sum', () {
      loadPackage();

      expect(cubit.state.subtotalUsd, 97); // 2x30 + 25 + 12
      expect(cubit.state.advertisementDiscountUsd, 37); // 97 - 60
      expect(cubit.state.payableUsd, 60);
    });

    test('a package priced above its lines never becomes a surcharge', () {
      loadPackage(totalPriceUsd: 200);

      expect(cubit.state.advertisementDiscountUsd, 0);
      expect(cubit.state.payableUsd, cubit.state.subtotalUsd);
    });

    test('loading a package replaces a cart from another warehouse entirely', () {
      cubit.addProduct(_product('other'), warehouseId: 'B', warehouseName: 'Warehouse B', quantity: 1);
      expect(cubit.state.warehouseId, 'B');

      loadPackage();

      // One warehouse per cart: never merged.
      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.items.length, 3);
      expect(cubit.state.items.any((i) => i.productId == 'other'), isFalse);
    });

    test('hasConflictingWarehouse still reports a cross-warehouse package cart', () {
      loadPackage();

      expect(cubit.hasConflictingWarehouse('B'), isTrue);
      expect(cubit.hasConflictingWarehouse('A'), isFalse);
    });
  });

  group('editing a package cart', () {
    test('raising a package line above its advertised quantity keeps the package', () {
      loadPackage();

      cubit.updateQuantity('p1', 4); // advertised is 2

      expect(cubit.state.hasAdvertisement, isTrue);
      // 4x30 + 25 + 12 = 157, and the discount is still exactly one $37.
      expect(cubit.state.subtotalUsd, 157);
      expect(cubit.state.advertisementDiscountUsd, 37);
      expect(cubit.state.payableUsd, 120); // 60 package + 2 extra p1 at $30
    });

    test('dropping a package line BELOW its advertised quantity breaks the package', () {
      loadPackage();

      cubit.updateQuantity('p1', 1); // advertised is 2

      expect(cubit.state.hasAdvertisement, isFalse);
      expect(cubit.state.advertisementId, isNull);
      expect(cubit.state.advertisementDiscountUsd, 0);
      expect(cubit.state.subtotalUsd, 67); // 30 + 25 + 12 at qty 1 each
      expect(cubit.state.payableUsd, 67);
    });

    test('removing an advertised product ends the package price', () {
      loadPackage();

      cubit.removeItem('p3');

      expect(cubit.state.hasAdvertisement, isFalse);
      expect(cubit.state.advertisementId, isNull);
      expect(cubit.state.advertisementDiscountUsd, 0);
      expect(cubit.state.subtotalUsd, 85); // 2x30 + 25
      expect(cubit.state.payableUsd, 85);
    });

    test('adding a normal product keeps the package intact', () {
      loadPackage();

      cubit.addProduct(_product('extra'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);

      expect(cubit.state.hasAdvertisement, isTrue);
      expect(cubit.state.advertisementId, 'ad1');
      expect(cubit.state.subtotalUsd, 117); // 97 catalog + 2 x $10 normal
      expect(cubit.state.advertisementDiscountUsd, 37);
      expect(cubit.state.payableUsd, 80);
      expect(cubit.state.items.firstWhere((i) => i.productId == 'extra').isAdvertised, isFalse);
    });

    test('removing a non-advertised extra leaves the package alone', () {
      loadPackage();
      cubit.addProduct(_product('extra'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);

      cubit.removeItem('extra');

      expect(cubit.state.hasAdvertisement, isTrue);
      expect(cubit.state.advertisementDiscountUsd, 37);
      expect(cubit.state.payableUsd, 60);
    });
  });

  group('checkout', () {
    test('submitOrder sends the advertisement id and no prices', () async {
      when(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          advertisementId: any(named: 'advertisementId'),
        ),
      ).thenAnswer((_) async => _fakeOrder);

      loadPackage();
      await cubit.submitOrder();

      final captured = verify(
        () => orderRepo.submitOrder(
          warehouseId: captureAny(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          advertisementId: captureAny(named: 'advertisementId'),
        ),
      ).captured;
      expect(captured[0], 'A');
      expect(captured[1], 'ad1');
    });

    test('a broken package submits with no advertisement id at all', () async {
      when(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          advertisementId: any(named: 'advertisementId'),
        ),
      ).thenAnswer((_) async => _fakeOrder);

      loadPackage();
      cubit.removeItem('p3');
      await cubit.submitOrder();

      final captured = verify(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          advertisementId: captureAny(named: 'advertisementId'),
        ),
      ).captured;
      expect(captured.single, isNull);
    });
  });

  group('a normal cart is completely unaffected', () {
    test('no advertisement means no discount and payable == subtotal', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);

      expect(cubit.state.hasAdvertisement, isFalse);
      expect(cubit.state.advertisementId, isNull);
      expect(cubit.state.advertisementDiscountUsd, 0);
      expect(cubit.state.subtotalUsd, 20);
      expect(cubit.state.payableUsd, 20);
      expect(cubit.state.items.single.isAdvertised, isFalse);
    });

    test('removing the last item resets the cart completely', () {
      loadPackage();
      cubit.removeItem('p1');
      cubit.removeItem('p2');
      cubit.removeItem('p3');

      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.warehouseId, isNull);
      expect(cubit.state.advertisementId, isNull);
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
