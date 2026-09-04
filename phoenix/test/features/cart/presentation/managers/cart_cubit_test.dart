import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';

class MockOrderRepository extends Mock implements OrderRepository {}

class MockWarehouseRepository extends Mock implements WarehouseRepository {}

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
  setUpAll(() {
    registerFallbackValue(<CartItem>[]);
  });

  late MockOrderRepository orderRepo;
  late MockWarehouseRepository warehouseRepo;
  late CartCubit cubit;

  setUp(() {
    orderRepo = MockOrderRepository();
    warehouseRepo = MockWarehouseRepository();
    // addProduct/replaceWithProduct kick off a fire-and-forget order-limits
    // fetch. The cubit swallows its failures by design, so a throwing stub
    // keeps these tests focused on the one-warehouse rule.
    when(
      () => warehouseRepo.getWarehouseProfile(any()),
    ).thenAnswer((_) async => throw Exception('limits fetch not exercised here'));
    cubit = CartCubit(orderRepository: orderRepo, warehouseRepository: warehouseRepo);
  });

  tearDown(() => cubit.close());

  group('One Warehouse Per Order', () {
    test('Test 1: adding to an empty cart binds the cart to that warehouse', () {
      cubit.addProduct(
        _product('p1'),
        warehouseId: 'A',
        warehouseName: 'Warehouse A',
        quantity: 2,
      );

      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.warehouseName, 'Warehouse A');
      expect(cubit.state.items.single.productId, 'p1');
      expect(cubit.state.itemCount, 2);
    });

    test('Test 2: a second product from the same warehouse is added normally', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 3);

      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p1', 'p2']);
      expect(cubit.state.itemCount, 4);
    });

    test(
      'Test 3: a product from a different warehouse is flagged as a conflict and NOT added',
      () {
        cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);

        // This is exactly the check CatalogView runs before showing the
        // "start a new cart?" confirmation dialog.
        expect(cubit.hasConflictingWarehouse('B'), isTrue);

        cubit.addProduct(_product('p3'), warehouseId: 'B', warehouseName: 'Warehouse B', quantity: 1);

        // Guard held: cart untouched - still Warehouse A with only p1.
        expect(cubit.state.warehouseId, 'A');
        expect(cubit.state.warehouseName, 'Warehouse A');
        expect(cubit.state.items.map((i) => i.productId).toList(), ['p1']);
        expect(cubit.state.itemCount, 1);
      },
    );

    test('Test 4: "Cancel" - the cart is left exactly as it was', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
      final itemsBefore = cubit.state.items;

      // Cancelling the dialog == the UI simply does not call
      // replaceWithProduct. Nothing mutates.
      expect(cubit.hasConflictingWarehouse('B'), isTrue);

      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.items, same(itemsBefore));
      expect(cubit.state.itemCount, 3);
    });

    test('Test 5: "Clear Cart & Add" - replaceWithProduct rebinds the cart to Warehouse B', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);

      cubit.replaceWithProduct(
        _product('p3'),
        warehouseId: 'B',
        warehouseName: 'Warehouse B',
        quantity: 5,
      );

      expect(cubit.state.warehouseId, 'B');
      expect(cubit.state.warehouseName, 'Warehouse B');
      expect(cubit.state.items.single.productId, 'p3');
      expect(cubit.state.itemCount, 5);
      expect(cubit.hasConflictingWarehouse('B'), isFalse);
      // ...and now a product from B can be added on top.
      cubit.addProduct(_product('p4'), warehouseId: 'B', warehouseName: 'Warehouse B', quantity: 1);
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p3', 'p4']);
    });

    test('Test 6: submitOrder posts a single warehouseId for the whole cart', () async {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
      // A cross-warehouse item never made it in (Test 3), so by construction
      // every item here belongs to warehouseId 'A'.
      when(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
        ),
      ).thenAnswer((_) async => _fakeOrder);

      await cubit.submitOrder();

      final captured = verify(
        () => orderRepo.submitOrder(
          warehouseId: captureAny(named: 'warehouseId'),
          items: captureAny(named: 'items'),
          notes: any(named: 'notes'),
        ),
      ).captured;
      expect(captured[0], 'A');
      final items = (captured[1] as List<CartItem>).map((i) => i.productId).toList();
      expect(items, ['p1', 'p2']);
      // The request shape carries no per-item warehouse - a multi-warehouse
      // order cannot even be expressed.
    });
  });

  group('badge / itemCount reacts to every mutation', () {
    test('add -> add -> update quantity -> remove -> clear', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'A', quantity: 1);
      expect(cubit.state.itemCount, 1);

      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'A', quantity: 1);
      expect(cubit.state.itemCount, 2);

      cubit.updateQuantity('p1', 4);
      expect(cubit.state.itemCount, 5);

      cubit.removeItem('p2');
      expect(cubit.state.itemCount, 4);

      cubit.removeItem('p1');
      expect(cubit.state.itemCount, 0);
      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.warehouseId, isNull);
    });

    test('emits a new state on each mutation (drives BlocBuilder rebuilds)', () {
      expectLater(
        cubit.stream.map((s) => s.itemCount),
        emitsInOrder(<int>[1, 3, 2, 0]),
      );

      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'A', quantity: 1);
      cubit.updateQuantity('p1', 3);
      cubit.updateQuantity('p1', 2);
      cubit.removeItem('p1');
    });
  });

  group('Reorder loads a past order into the existing cart', () {
    List<CartItem> reorderLines() => [
      CartItem.fromProduct(_product('p1'), quantity: 3),
      CartItem.fromProduct(_product('p2'), quantity: 1),
    ];

    test('loadReorder maps every product + quantity and binds the cart to that warehouse', () {
      cubit.loadReorder(warehouseId: 'A', warehouseName: 'Warehouse A', items: reorderLines());

      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.warehouseName, 'Warehouse A');
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p1', 'p2']);
      expect(cubit.state.items.map((i) => i.quantity).toList(), [3, 1]);
      expect(cubit.state.itemCount, 4);
    });

    test('loadReorder replaces whatever was in the cart (no silent merge)', () {
      cubit.addProduct(_product('old'), warehouseId: 'B', warehouseName: 'Warehouse B', quantity: 9);

      cubit.loadReorder(warehouseId: 'A', warehouseName: 'Warehouse A', items: reorderLines());

      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p1', 'p2']);
    });

    test('a reordered cart is a normal cart: quantity edits, removals and same-warehouse adds all work', () {
      cubit.loadReorder(warehouseId: 'A', warehouseName: 'Warehouse A', items: reorderLines());

      cubit.updateQuantity('p1', 10);
      expect(cubit.state.items.firstWhere((i) => i.productId == 'p1').quantity, 10);

      cubit.removeItem('p2');
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p1']);

      // "Add Product" from the same warehouse -> added on top, no conflict.
      expect(cubit.hasConflictingWarehouse('A'), isFalse);
      cubit.addProduct(_product('p9'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p1', 'p9']);
    });

    test('the reordered cart keeps the one-warehouse rule for a foreign "Add Product"', () {
      cubit.loadReorder(warehouseId: 'A', warehouseName: 'Warehouse A', items: reorderLines());

      // A product from another warehouse is still a conflict and is not added.
      expect(cubit.hasConflictingWarehouse('B'), isTrue);
      cubit.addProduct(_product('pB'), warehouseId: 'B', warehouseName: 'Warehouse B', quantity: 1);
      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p1', 'p2']);
    });

    test('removing every reordered line falls back to the normal empty-cart state', () {
      cubit.loadReorder(warehouseId: 'A', warehouseName: 'Warehouse A', items: reorderLines());

      cubit.removeItem('p1');
      cubit.removeItem('p2');

      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.warehouseId, isNull);
    });
  });
}
