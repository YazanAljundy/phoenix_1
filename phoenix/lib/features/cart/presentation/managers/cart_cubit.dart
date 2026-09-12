import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';

import 'cart_state.dart';

// Section 6.6: every order belongs to exactly one warehouse, so the cart as a
// whole is scoped to one warehouseId at a time. Registered globally (like
// AuthCubit) since it must survive navigation between the catalog and cart
// screens, and even a trip back to warehouse selection.
class CartCubit extends Cubit<CartState> {
  CartCubit({
    required OrderRepository orderRepository,
    required WarehouseRepository warehouseRepository,
  })  : _orderRepository = orderRepository,
        _warehouseRepository = warehouseRepository,
        super(const CartState());

  final OrderRepository _orderRepository;
  final WarehouseRepository _warehouseRepository;
  final Uuid _uuid = const Uuid();

  // The warehouse's own order-size limits (backend: warehouse.model.js).
  // Fetched once per warehouse, when the cart first points at it, so the
  // cart can show the limit and gate the submit button locally instead of
  // only finding out on a rejected submit.
  //
  // Deliberately silent on failure: leaving the limits at their "none"
  // defaults means a lookup problem can never block an otherwise valid
  // order - order.service.js enforces the real rule either way.
  Future<void> _loadWarehouseLimits(String warehouseId) async {
    try {
      final profile = await _warehouseRepository.getWarehouseProfile(warehouseId);
      if (isClosed || state.warehouseId != warehouseId) return;
      emit(
        state.copyWith(
          minOrderAmountUsd: profile.minOrderAmountUsd,
          maxOrderAmountUsd: profile.maxOrderAmountUsd,
          clearMaxOrderAmount: profile.maxOrderAmountUsd == null,
        ),
      );
    } catch (_) {
      // See above - intentionally ignored.
    }
  }

  bool hasConflictingWarehouse(String warehouseId) =>
      state.items.isNotEmpty && state.warehouseId != warehouseId;

  void addProduct(
    ProductModel product, {
    required String warehouseId,
    required String warehouseName,
    required int quantity,
  }) {
    // One-warehouse-per-order (Section 6.6): addProduct must never build a
    // mixed cart. The UI resolves a cross-warehouse add first - confirm
    // dialog, then replaceWithProduct - so on the normal path this is never
    // true. It's here so the invariant holds at the cubit level regardless
    // of the caller: a skipped check yields a no-op, not a corrupted cart.
    if (hasConflictingWarehouse(warehouseId)) return;

    final existingIndex = state.items.indexWhere((item) => item.productId == product.id);
    final List<CartItem> updated;
    if (existingIndex >= 0) {
      final existing = state.items[existingIndex];
      updated = List.of(state.items)
        ..[existingIndex] = existing.copyWith(quantity: existing.quantity + quantity);
    } else {
      updated = [...state.items, CartItem.fromProduct(product, quantity: quantity)];
    }
    final warehouseChanged = state.warehouseId != warehouseId;
    emit(
      state.copyWith(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: updated,
        clearError: true,
      ),
    );
    if (warehouseChanged) _loadWarehouseLimits(warehouseId);
  }

  // Used after the pharmacist confirms replacing a cart that has items from
  // a different warehouse (see hasConflictingWarehouse).
  void replaceWithProduct(
    ProductModel product, {
    required String warehouseId,
    required String warehouseName,
    required int quantity,
  }) {
    emit(
      CartState(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: [CartItem.fromProduct(product, quantity: quantity)],
      ),
    );
    _loadWarehouseLimits(warehouseId);
  }

  // "Reorder an existing order": replaces the whole cart with a past order's
  // contents, bound to that order's own warehouse (Section 4 - the warehouse
  // comes from the trusted server payload, never client input). Same
  // one-warehouse-per-cart invariant as replaceWithProduct; the caller
  // (ReorderButton) resolves any "you already have a cart" confirmation first.
  // `items` are already priced with the current catalog price by the server -
  // no historical prices are carried over, and checkout re-validates every
  // line as usual.
  void loadReorder({
    required String warehouseId,
    required String warehouseName,
    required List<CartItem> items,
  }) {
    emit(
      CartState(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: List.of(items),
      ),
    );
    _loadWarehouseLimits(warehouseId);
  }

  // "Add a package to the cart": a package behaves exactly like a product -
  // ONE line, whose quantity is the number of copies. Adding the same package
  // again bumps that line's copies rather than creating a second one, which is
  // the same rule addProduct applies to a repeated product.
  //
  // The products inside the package are never separate lines: the server
  // builds the real order lines from the package itself at checkout, so the
  // cart only ever names it and says how many.
  void addPackage(
    CartItem packageLine, {
    required String warehouseId,
    required String warehouseName,
  }) {
    if (hasConflictingWarehouse(warehouseId)) return;

    final existingIndex = state.items.indexWhere(
      (item) => item.isPackage && item.packageId == packageLine.packageId,
    );
    final List<CartItem> updated;
    if (existingIndex >= 0) {
      final existing = state.items[existingIndex];
      updated = List.of(state.items)
        ..[existingIndex] = existing.copyWith(
          quantity: existing.quantity + packageLine.quantity,
        );
    } else {
      updated = [...state.items, packageLine];
    }

    final warehouseChanged = state.warehouseId != warehouseId;
    emit(
      state.copyWith(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: updated,
        clearError: true,
      ),
    );
    if (warehouseChanged) _loadWarehouseLimits(warehouseId);
  }

  /// Replaces the whole cart with a single package, for the "your cart holds
  /// another warehouse's items" path - the same shape replaceWithProduct has.
  void replaceWithPackage(
    CartItem packageLine, {
    required String warehouseId,
    required String warehouseName,
  }) {
    emit(
      CartState(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: [packageLine],
      ),
    );
    _loadWarehouseLimits(warehouseId);
  }

  // Packages the server has reported as no longer available - paused by their
  // warehouse or an admin after they went into the cart. The lines are kept,
  // not dropped: the tile explains what happened and the pharmacist decides to
  // remove them. Nothing here blocks checkout; the server refuses them there.
  void markPackagesUnavailable(Iterable<String> packageIds) {
    final ids = packageIds.toSet();
    final needsFlag = state.items.any(
      (item) => item.isPackage && item.isAvailable && ids.contains(item.packageId),
    );
    if (!needsFlag) return;
    emit(state.copyWith(items: _flagUnavailablePackages(ids)));
  }

  /// The one-tap way out of a PACKAGE_UNAVAILABLE refusal: drops every package
  /// line flagged unavailable and leaves the rest of the cart as it was.
  void removeUnavailablePackages() {
    final updated = state.items.where((item) => !(item.isPackage && !item.isAvailable)).toList();
    if (updated.length == state.items.length) return;
    if (updated.isEmpty) {
      emit(const CartState());
      return;
    }
    emit(state.copyWith(items: updated));
  }

  List<CartItem> _flagUnavailablePackages(Set<String> packageIds) => state.items
      .map((item) => item.isPackage && packageIds.contains(item.packageId)
          ? item.copyWith(isAvailable: false)
          : item)
      .toList();

  // Works the same for a product line and a package line: for a package the
  // number IS the copy count. There is no "breaking a package" any more - its
  // contents are not cart lines, so nothing can be taken out of one.
  void updateQuantity(String lineKey, int quantity) {
    final clamped = quantity < 1 ? 1 : quantity;
    final updated = state.items.map((item) {
      if (item.lineKey != lineKey) return item;
      return item.copyWith(quantity: clamped);
    }).toList();
    emit(state.copyWith(items: updated));
  }

  void removeItem(String lineKey) {
    final updated = state.items.where((item) => item.lineKey != lineKey).toList();
    if (updated.isEmpty) {
      emit(const CartState());
      return;
    }
    emit(state.copyWith(items: updated));
  }

  // "Clear the cart": drops every line at once. Resets to a pristine
  // CartState rather than just emptying `items` - exactly what removeItem
  // already does when the last line goes - so the warehouse binding, the
  // notes, any advertisement package and the loaded order limits all go with
  // it. Nothing is sent to the server: the cart only exists on the client
  // until submitOrder.
  void clearCart() {
    if (state.isEmpty) return;
    emit(const CartState());
  }

  void updateNotes(String notes) => emit(state.copyWith(notes: notes));

  // Client-side availability snapshots (taken when items were added) can go
  // stale by the time the pharmacist actually submits - the server re-checks
  // isAvailable for real (Section 7/8) and this surfaces whatever
  // human-readable message it returns.
  Future<OrderModel?> submitOrder() async {
    if (state.warehouseId == null) return null;
    // Unreachable through the normal UI (CartView swaps to its empty-cart
    // view once items.isEmpty), but a real, user-visible message here rather
    // than a silent no-op covers any edge case that still reaches this call
    // - e.g. the last item being removed in the gap between tapping submit
    // and this running.
    if (state.items.isEmpty) {
      emit(state.copyWith(errorMessage: 'Your cart is empty.', errorCode: 'CART_EMPTY'));
      return null;
    }

    // Money-Flow V2 idempotency: minted on the FIRST attempt only and kept in
    // the state, so every retry of this same cart carries the same key and
    // the server returns the order the first attempt created instead of
    // placing a second one. Generating it inside the request below would give
    // each retry a fresh key and defeat the whole mechanism. It's cleared
    // with the cart itself, on success or on any reset to a bare CartState.
    final idempotencyKey = state.pendingIdempotencyKey ?? _uuid.v4();
    emit(state.copyWith(
      isSubmitting: true,
      pendingIdempotencyKey: idempotencyKey,
      clearError: true,
    ));
    try {
      final order = await _orderRepository.submitOrder(
        warehouseId: state.warehouseId!,
        items: state.items,
        notes: state.notes.trim().isEmpty ? null : state.notes.trim(),
        // The repository splits `items` into loose product lines and packages:
        // a package crosses the wire as { advertisementId, copies } and
        // nothing else, and the server prices it from its own record.
        idempotencyKey: idempotencyKey,
      );
      emit(const CartState());
      return order;
    } on Failure catch (f) {
      // PACKAGE_UNAVAILABLE names the refused packages. Flagging those lines in
      // this same emit puts each tile's warning on screen together with the
      // error dialog that explains it.
      final refusedPackageIds = f.code == 'PACKAGE_UNAVAILABLE'
          ? ((f.details?['advertisementIds'] as List?) ?? const [])
              .map((id) => id.toString())
              .toSet()
          : const <String>{};
      emit(
        state.copyWith(
          items: refusedPackageIds.isEmpty ? null : _flagUnavailablePackages(refusedPackageIds),
          isSubmitting: false,
          errorMessage: f.errMessage,
          errorCode: f.code,
          errorDetails: f.details,
        ),
      );
      return null;
    } catch (e) {
      // Anything that isn't a Failure (e.g. a response-parsing bug) must
      // still land the cubit in a terminal state - otherwise isSubmitting
      // stays true forever and the submit button spins with no error ever
      // shown (the "submit order freezes" report this fixes).
      emit(state.copyWith(isSubmitting: false, errorMessage: 'Unexpected error', errorCode: 'UNEXPECTED_ERROR'));
      return null;
    }
  }
}
