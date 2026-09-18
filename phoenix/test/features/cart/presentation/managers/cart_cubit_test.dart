import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/cart/presentation/managers/cart_state.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';

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
      expect(cubit.state.items.single.quantity, 2);
      expect(cubit.state.itemCount, 1, reason: 'one line, whatever its quantity');
    });

    test('Test 2: a second product from the same warehouse is added normally', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 3);

      expect(cubit.state.warehouseId, 'A');
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p1', 'p2']);
      expect(cubit.state.itemCount, 2, reason: 'two lines');
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
      expect(cubit.state.itemCount, 2, reason: 'two lines');
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
      expect(cubit.state.items.single.quantity, 5);
      expect(cubit.state.itemCount, 1);
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
          idempotencyKey: any(named: 'idempotencyKey'),
          rateUsed: any(named: 'rateUsed'),
        ),
      ).thenAnswer((_) async => _fakeOrder);

      await cubit.submitOrder();

      final captured = verify(
        () => orderRepo.submitOrder(
          warehouseId: captureAny(named: 'warehouseId'),
          items: captureAny(named: 'items'),
          notes: any(named: 'notes'),
          idempotencyKey: any(named: 'idempotencyKey'),
          rateUsed: any(named: 'rateUsed'),
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

      // Raising a line's quantity does NOT move the badge: it still counts
      // lines, and there are still two things in the cart.
      cubit.updateQuantity('p1', 4);
      expect(cubit.state.itemCount, 2);

      cubit.removeItem('p2');
      expect(cubit.state.itemCount, 1);

      cubit.removeItem('p1');
      expect(cubit.state.itemCount, 0);
      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.warehouseId, isNull);
    });

    test('emits a new state on each mutation (drives BlocBuilder rebuilds)', () {
      // Watched on the total units rather than the badge: the badge counts
      // lines now, so a quantity change would not move it and the point here
      // is that every mutation emits.
      expectLater(
        cubit.stream.map((s) => s.items.fold<int>(0, (sum, i) => sum + i.quantity)),
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
      expect(cubit.state.itemCount, 2, reason: 'two lines');
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

  group('Clear cart empties every line at once', () {
    test('drops all items and resets the cart to its pristine state', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 3);
      cubit.updateNotes('leave at the back door');
      expect(cubit.state.items, hasLength(2));

      cubit.clearCart();

      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.itemCount, 0);
      // The whole cart goes, not just the lines: the warehouse binding and
      // the notes go with them, exactly as when the last line is removed.
      expect(cubit.state.warehouseId, isNull);
      expect(cubit.state.warehouseName, isNull);
      expect(cubit.state.notes, isEmpty);
      expect(cubit.state.subtotalUsd, 0);
    });

    test('a package line is dropped with the rest of the cart', () {
      cubit.addPackage(
        CartItem.fromPackage(
          packageId: 'ad1',
          titleAr: 'b',
          warehouseName: 'Warehouse A',
          pricePerCopyUsd: 8,
          copies: 1,
          contents: const [],
        ),
        warehouseId: 'A',
        warehouseName: 'Warehouse A',
      );

      cubit.clearCart();

      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.hasPackage, isFalse);
    });

    test('emits so the UI rebuilds, and is a no-op on an already empty cart', () {
      expectLater(cubit.stream.map((s) => s.itemCount), emitsInOrder(<int>[1, 0]));

      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'A', quantity: 1);
      cubit.clearCart();

      // Nothing left to clear - no further state is emitted (the assertion
      // above would see an extra 0 otherwise).
      cubit.clearCart();
      expect(cubit.state.isEmpty, isTrue);
    });

    test('the cart is usable again straight after a clear', () {
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.clearCart();

      // With the binding gone, ANY warehouse is fair game again - the
      // one-warehouse rule no longer has a cart to conflict with.
      expect(cubit.hasConflictingWarehouse('B'), isFalse);
      cubit.addProduct(_product('p2'), warehouseId: 'B', warehouseName: 'Warehouse B', quantity: 1);
      expect(cubit.state.warehouseId, 'B');
      expect(cubit.state.items.map((i) => i.productId).toList(), ['p2']);
    });
  });

  // The server replays an order for a known key only when the request is the
  // same one, and refuses the key for any other (IDEMPOTENCY_KEY_REUSED). So
  // the key must survive a plain retry but not an edit - otherwise a submit
  // whose response was lost, followed by an edit and a resubmit, would get the
  // unedited order back and the cart would be cleared as if the edit had been
  // ordered.
  group('Order idempotency key follows the cart contents', () {
    // Every submit's key, in order.
    late List<String?> sentKeys;
    // Every submit's lines, in order.
    late List<List<CartItem>> sentItems;
    // Thrown by the next submits, first to last; once empty, submits succeed.
    late List<Failure> nextFailures;

    final networkFailure = ServerFailure('No Internet Connection', code: FailureCode.network);

    CartItem packageLine(String id) => CartItem.fromPackage(
      packageId: id,
      titleAr: 'باقة',
      warehouseName: 'Warehouse A',
      pricePerCopyUsd: 8,
      copies: 1,
      contents: const [],
    );

    setUp(() {
      sentKeys = [];
      sentItems = [];
      nextFailures = [];
      when(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          idempotencyKey: any(named: 'idempotencyKey'),
          rateUsed: any(named: 'rateUsed'),
        ),
      ).thenAnswer((invocation) async {
        sentKeys.add(invocation.namedArguments[#idempotencyKey] as String?);
        sentItems.add(List.of(invocation.namedArguments[#items] as List<CartItem>));
        if (nextFailures.isNotEmpty) throw nextFailures.removeAt(0);
        return _fakeOrder;
      });

      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
    });

    // The first attempt's response never arrives: all the app sees is a
    // network error, while the server may well have placed the order.
    Future<String> submitAndLoseTheResponse() async {
      nextFailures.add(networkFailure);
      final order = await cubit.submitOrder();
      expect(order, isNull);
      expect(cubit.state.errorCode, FailureCode.network);
      expect(cubit.state.items, isNotEmpty, reason: 'a failed submit keeps the cart');
      final key = cubit.state.pendingIdempotencyKey;
      expect(key, isNotNull, reason: 'kept for the retry');
      return key!;
    }

    test('a plain retry after a network failure reuses the same key', () async {
      final firstKey = await submitAndLoseTheResponse();

      final order = await cubit.submitOrder();

      expect(order, same(_fakeOrder));
      expect(sentKeys, [firstKey, firstKey]);
      expect(cubit.state.isEmpty, isTrue);
      expect(cubit.state.pendingIdempotencyKey, isNull);
    });

    final edits = <String, void Function(CartCubit)>{
      'updateQuantity': (c) => c.updateQuantity('p1', 5),
      'removeItem': (c) => c.removeItem('p2'),
      'addProduct (new line)': (c) =>
          c.addProduct(_product('p3'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1),
      'addProduct (existing line)': (c) =>
          c.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2),
      'addPackage': (c) =>
          c.addPackage(packageLine('ad1'), warehouseId: 'A', warehouseName: 'Warehouse A'),
      'updateNotes': (c) => c.updateNotes('leave at the back door'),
    };

    for (final entry in edits.entries) {
      test('${entry.key} after a network failure makes the resubmit use a new key', () async {
        final firstKey = await submitAndLoseTheResponse();

        entry.value(cubit);
        expect(cubit.state.pendingIdempotencyKey, isNull, reason: 'dropped by the edit');

        final order = await cubit.submitOrder();

        expect(order, same(_fakeOrder));
        expect(sentKeys, hasLength(2));
        expect(sentKeys.last, isNotNull);
        expect(sentKeys.last, isNot(firstKey),
            reason: 'the old key would get the unedited order back from the server');
        expect(cubit.state.isEmpty, isTrue);
      });
    }

    test('what the new key carries is the edited cart', () async {
      await submitAndLoseTheResponse();

      cubit.updateQuantity('p1', 5);
      cubit.removeItem('p2');
      await cubit.submitOrder();

      final resubmitted = sentItems.last;
      expect(resubmitted.map((i) => i.productId).toList(), ['p1']);
      expect(resubmitted.single.quantity, 5);
    });

    test('removeUnavailablePackages after a network failure makes the resubmit use a new key', () async {
      cubit.addPackage(packageLine('ad1'), warehouseId: 'A', warehouseName: 'Warehouse A');
      final firstKey = await submitAndLoseTheResponse();

      cubit.markPackagesUnavailable(['ad1']);
      expect(cubit.state.pendingIdempotencyKey, firstKey,
          reason: 'flagging is display-only and changes nothing that is sent');

      cubit.removeUnavailablePackages();
      expect(cubit.state.pendingIdempotencyKey, isNull);

      await cubit.submitOrder();
      expect(sentKeys.last, isNot(firstKey));
      expect(sentItems.last.any((i) => i.isPackage), isFalse);
    });

    // A second key here would let the retry place the same order twice if the
    // first attempt had in fact gone through.
    test('a call that changes nothing that is sent keeps the key', () async {
      cubit.updateNotes('back door');
      final firstKey = await submitAndLoseTheResponse();

      cubit.updateQuantity('p1', 1); // already 1
      cubit.updateQuantity('p1', 0); // clamped to 1
      cubit.updateQuantity('not-in-cart', 3);
      cubit.removeItem('not-in-cart');
      cubit.updateNotes('  back door  '); // only surrounding whitespace
      expect(cubit.state.pendingIdempotencyKey, firstKey);

      await cubit.submitOrder();

      expect(sentKeys, [firstKey, firstKey]);
    });

    test('IDEMPOTENCY_KEY_REUSED drops the key, so the next submit places the cart as a new order', () async {
      final keptKey = await submitAndLoseTheResponse();

      nextFailures.add(
        ServerFailure(
          'This order request was already submitted with different contents.',
          code: 'IDEMPOTENCY_KEY_REUSED',
          details: {'orderId': 'o0', 'orderNumber': 41},
          statusCode: 409,
        ),
      );
      final refused = await cubit.submitOrder();

      expect(refused, isNull);
      expect(cubit.state.errorCode, 'IDEMPOTENCY_KEY_REUSED');
      expect(cubit.state.errorDetails?['orderNumber'], 41);
      expect(cubit.state.items, hasLength(2), reason: 'the cart is kept, not cleared');
      expect(cubit.state.pendingIdempotencyKey, isNull);

      final order = await cubit.submitOrder();

      expect(order, same(_fakeOrder));
      expect(sentKeys, hasLength(3));
      expect(sentKeys[1], keptKey);
      expect(sentKeys[2], isNot(keptKey));
    });

    test('any other server refusal keeps the key', () async {
      final firstKey = await submitAndLoseTheResponse();

      nextFailures.add(ServerFailure('Your cart is empty.', code: 'CART_EMPTY', statusCode: 400));
      await cubit.submitOrder();

      expect(cubit.state.pendingIdempotencyKey, firstKey);
    });
  });

  // A PRICE_CHANGED refusal used to leave the cart's price snapshot alone, so
  // every resubmit sent the same stale displayedUnitPriceUsd and was refused
  // again. The refused lines now take the server's price - and are not sent
  // until the pharmacist confirms it.
  group('PRICE_CHANGED refreshes the cart prices', () {
    late List<String?> sentKeys;
    late List<List<CartItem>> sentItems;
    late List<Failure> nextFailures;

    CartItem packageLine(String id) => CartItem.fromPackage(
      packageId: id,
      titleAr: 'باقة',
      warehouseName: 'Warehouse A',
      pricePerCopyUsd: 8,
      copies: 1,
      contents: const [],
    );

    // The server's shape - order.service.js's priceProblems entries.
    Map<String, dynamic> problem(String productId, num displayed, num current) => {
      'code': 'PRICE_CHANGED',
      'productId': productId,
      'displayedPriceUsd': displayed,
      'currentPriceUsd': current,
    };

    ServerFailure priceChanged(List<Map<String, dynamic>> problems) => ServerFailure(
      'Some prices changed.',
      code: 'PRICE_CHANGED',
      details: {'problems': problems},
      statusCode: 400,
    );

    CartItem line(String productId) =>
        cubit.state.items.firstWhere((item) => item.productId == productId);

    setUp(() {
      sentKeys = [];
      sentItems = [];
      nextFailures = [];
      when(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          idempotencyKey: any(named: 'idempotencyKey'),
          rateUsed: any(named: 'rateUsed'),
        ),
      ).thenAnswer((invocation) async {
        sentKeys.add(invocation.namedArguments[#idempotencyKey] as String?);
        sentItems.add(List.of(invocation.namedArguments[#items] as List<CartItem>));
        if (nextFailures.isNotEmpty) throw nextFailures.removeAt(0);
        return _fakeOrder;
      });

      // Every product lists at 10 USD with no offer (see _product).
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
      cubit.addProduct(_product('p2'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 1);
      cubit.addProduct(_product('p3'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 3);
    });

    test('a single-line refusal reprices that line and no other', () async {
      nextFailures.add(priceChanged([problem('p1', 10, 12)]));

      final order = await cubit.submitOrder();

      expect(order, isNull);
      expect(cubit.state.errorCode, 'PRICE_CHANGED');
      expect(line('p1').discountPriceUsd, 12);
      expect(line('p1').previousPriceUsd, 10, reason: 'what the pharmacist had been shown');
      expect(line('p1').lineTotalUsd, 24, reason: 'derived from the new price');
      for (final untouched in ['p2', 'p3']) {
        expect(line(untouched).discountPriceUsd, 10, reason: untouched);
        expect(line(untouched).hasUnconfirmedPriceChange, isFalse, reason: untouched);
      }
      expect(cubit.state.subtotalUsd, 12 * 2 + 10 * 1 + 10 * 3);
      expect(cubit.state.items.map((i) => i.quantity).toList(), [2, 1, 3], reason: 'only prices move');
    });

    test('a multi-line refusal reprices every affected line', () async {
      nextFailures.add(priceChanged([problem('p1', 10, 12), problem('p3', 10, 8.5)]));

      await cubit.submitOrder();

      expect(line('p1').discountPriceUsd, 12);
      expect(line('p3').discountPriceUsd, 8.5);
      expect(line('p1').previousPriceUsd, 10);
      expect(line('p3').previousPriceUsd, 10);
      expect(line('p2').hasUnconfirmedPriceChange, isFalse);
      expect(cubit.state.unconfirmedPriceChanges.map((p) => p['productId']).toList(), ['p1', 'p3']);
      expect(cubit.state.subtotalUsd, 12 * 2 + 10 * 1 + 8.5 * 3);
    });

    test('a repriced line shows no struck-through "was" price', () async {
      // A price rise with the old 10 kept as unitPriceUsd would render as
      // "10 struck through, 12" - an offer that does not exist.
      nextFailures.add(priceChanged([problem('p1', 10, 12)]));

      await cubit.submitOrder();

      expect(line('p1').unitPriceUsd, 12);
      expect(line('p1').hasOffer, isFalse);
    });

    test('package lines and products not in the cart are never matched', () async {
      cubit.addPackage(packageLine('ad1'), warehouseId: 'A', warehouseName: 'Warehouse A');
      nextFailures.add(priceChanged([problem('ad1', 8, 99), problem('ghost', 1, 2), problem('p2', 10, 11)]));

      await cubit.submitOrder();

      final package = cubit.state.items.firstWhere((item) => item.isPackage);
      expect(package.discountPriceUsd, 8);
      expect(package.hasUnconfirmedPriceChange, isFalse);
      expect(cubit.state.items, hasLength(4), reason: 'nothing added for the unknown product');
      expect(line('p2').discountPriceUsd, 11);
    });

    test('nothing is resent until the pharmacist confirms the new prices', () async {
      nextFailures.add(priceChanged([problem('p1', 10, 12)]));
      await cubit.submitOrder();
      expect(sentItems, hasLength(1), reason: 'the refusal triggers no automatic retry');

      // A plain submit - the confirmation the pharmacist gave was for the old
      // price - is refused locally, without a request.
      final unconfirmed = await cubit.submitOrder();

      expect(unconfirmed, isNull);
      expect(sentItems, hasLength(1));
      expect(cubit.state.errorCode, 'PRICE_CHANGE_UNCONFIRMED');
      expect(line('p1').hasUnconfirmedPriceChange, isTrue);
      expect(cubit.state.isSubmitting, isFalse);

      // Accepting sends the cart, at the new price.
      final order = await cubit.submitOrder(acceptPriceChanges: true);

      expect(order, same(_fakeOrder));
      expect(sentItems, hasLength(2));
      final resentP1 = sentItems.last.firstWhere((item) => item.productId == 'p1');
      expect(resentP1.discountPriceUsd, 12, reason: 'the price the server asked for');
      expect(sentItems.last.every((item) => !item.hasUnconfirmedPriceChange), isTrue);
    });

    test('accepting with nothing to accept is an ordinary submit', () async {
      final order = await cubit.submitOrder(acceptPriceChanges: true);

      expect(order, same(_fakeOrder));
      expect(sentItems, hasLength(1));
    });

    test('an accepted change stays accepted across a network retry', () async {
      nextFailures.add(priceChanged([problem('p1', 10, 12)]));
      await cubit.submitOrder();

      nextFailures.add(ServerFailure('No Internet Connection', code: FailureCode.network));
      await cubit.submitOrder(acceptPriceChanges: true);
      expect(cubit.state.hasUnconfirmedPriceChanges, isFalse);

      // The retry is a plain submit: nothing left to confirm.
      final order = await cubit.submitOrder();

      expect(order, same(_fakeOrder));
      expect(sentItems, hasLength(3));
    });

    group('and the idempotency key', () {
      test('repricing drops the key in the same emit, via the edit rule', () async {
        final emitted = <CartState>[];
        final subscription = cubit.stream.listen(emitted.add);

        nextFailures.add(priceChanged([problem('p1', 10, 12)]));
        await cubit.submitOrder();
        await Future<void>.delayed(Duration.zero);
        await subscription.cancel();

        // No state ever showed the new price next to the old key.
        final repriced = emitted.where((s) => s.items.first.discountPriceUsd == 12).toList();
        expect(repriced, isNotEmpty);
        expect(repriced.every((s) => s.pendingIdempotencyKey == null), isTrue);
        expect(cubit.state.pendingIdempotencyKey, isNull);
      });

      test('the confirmed submit carries a new key', () async {
        nextFailures.add(priceChanged([problem('p1', 10, 12)]));
        await cubit.submitOrder();

        await cubit.submitOrder(acceptPriceChanges: true);

        expect(sentKeys, hasLength(2));
        expect(sentKeys[1], isNotNull);
        expect(sentKeys[1], isNot(sentKeys[0]));
      });

      test('confirming is not an edit: a retry after it reuses the confirmed key', () async {
        nextFailures.add(priceChanged([problem('p1', 10, 12)]));
        await cubit.submitOrder();

        nextFailures.add(ServerFailure('No Internet Connection', code: FailureCode.network));
        await cubit.submitOrder(acceptPriceChanges: true);
        final confirmedKey = cubit.state.pendingIdempotencyKey;
        expect(confirmedKey, isNotNull, reason: 'kept for the retry');

        await cubit.submitOrder();

        expect(sentKeys.sublist(1), [confirmedKey, confirmedKey]);
      });

      test('a refusal that reprices nothing keeps the key, like any no-op edit', () async {
        nextFailures.add(ServerFailure('No Internet Connection', code: FailureCode.network));
        await cubit.submitOrder();
        final keptKey = cubit.state.pendingIdempotencyKey;

        // Names a product that is not in the cart, and one already at the
        // quoted price.
        nextFailures.add(priceChanged([problem('ghost', 1, 2), problem('p2', 9, 10)]));
        await cubit.submitOrder();

        expect(cubit.state.hasUnconfirmedPriceChanges, isFalse);
        expect(cubit.state.pendingIdempotencyKey, keptKey);
      });
    });
  });

  // The rate the screen converted the total with rides along with the order,
  // so the server can refuse one agreed to at a rate that has since moved
  // (409 RATE_CHANGED - order.service.js). CartView turns that into its own
  // confirmation dialog; here is what the cubit itself does with it.
  group('The exchange rate the order was agreed at', () {
    late List<double?> sentRates;
    late List<String?> sentKeys;
    late List<Failure> nextFailures;

    ServerFailure rateChanged({num rateUsed = 1000, num current = 1200}) => ServerFailure(
      'The exchange rate changed since this amount was converted.',
      code: 'RATE_CHANGED',
      details: {'rateUsed': rateUsed, 'currentUsdToSyp': current},
      statusCode: 409,
    );

    setUp(() {
      sentRates = [];
      sentKeys = [];
      nextFailures = [];
      when(
        () => orderRepo.submitOrder(
          warehouseId: any(named: 'warehouseId'),
          items: any(named: 'items'),
          notes: any(named: 'notes'),
          idempotencyKey: any(named: 'idempotencyKey'),
          rateUsed: any(named: 'rateUsed'),
        ),
      ).thenAnswer((invocation) async {
        sentRates.add(invocation.namedArguments[#rateUsed] as double?);
        sentKeys.add(invocation.namedArguments[#idempotencyKey] as String?);
        if (nextFailures.isNotEmpty) throw nextFailures.removeAt(0);
        return _fakeOrder;
      });
      cubit.addProduct(_product('p1'), warehouseId: 'A', warehouseName: 'Warehouse A', quantity: 2);
    });

    test('is sent with the order when the caller has one', () async {
      await cubit.submitOrder(rateUsed: 1000);

      expect(sentRates, [1000.0]);
    });

    test('is simply absent when the app has no rate yet', () async {
      await cubit.submitOrder();

      // An app that has never fetched a rate still orders; the server skips
      // the check rather than refusing.
      expect(sentRates, [null]);
    });

    test('a RATE_CHANGED refusal leaves the cart exactly as it was', () async {
      nextFailures.add(rateChanged());

      final order = await cubit.submitOrder(rateUsed: 1000);

      expect(order, isNull);
      expect(cubit.state.items.single.productId, 'p1');
      expect(cubit.state.items.single.quantity, 2);
      expect(cubit.state.items.single.discountPriceUsd, 10);
      expect(cubit.state.hasUnconfirmedPriceChanges, isFalse);
      expect(cubit.state.isSubmitting, isFalse);
      // Published for CartView, which answers it with a confirmation dialog.
      expect(cubit.state.errorCode, 'RATE_CHANGED');
      expect(cubit.state.errorDetails, {'rateUsed': 1000, 'currentUsdToSyp': 1200});
    });

    test('the idempotency key survives it: the same cart is still the same order', () async {
      nextFailures.add(rateChanged());
      await cubit.submitOrder(rateUsed: 1000);
      final key = cubit.state.pendingIdempotencyKey;
      expect(key, isNotNull);

      // The pharmacist confirmed the new rate. Nothing about what is ordered
      // changed, so the server must see the same key and the same request -
      // rateUsed is deliberately not part of its fingerprint.
      await cubit.submitOrder(rateUsed: 1200);

      expect(sentKeys, [key, key]);
      expect(sentRates, [1000.0, 1200.0]);
    });

    test('nothing is resent on its own after the refusal', () async {
      nextFailures.add(rateChanged());

      await cubit.submitOrder(rateUsed: 1000);

      // One attempt, and it stops there until something asks again.
      expect(sentRates, hasLength(1));
    });
  });
}
