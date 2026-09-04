import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

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

  // "Open an advertisement": replaces the whole cart with a package's
  // contents, bound to that package's own warehouse (which comes from the
  // trusted server payload, never client input) - the same shape and the same
  // one-warehouse-per-cart invariant as loadReorder above. The caller
  // (AdvertisementCard) resolves any "you already have a cart" confirmation
  // first, exactly as ReorderButton does.
  //
  // `items` are already priced by the server at the advertised prices. The two
  // totals are display-only: submitOrder sends nothing but the advertisement's
  // id, and order.service.js re-reads the package and recomputes every figure.
  void loadAdvertisement({
    required String advertisementId,
    required String warehouseId,
    required String warehouseName,
    required List<CartItem> items,
    required num itemsSubtotalUsd,
    required num totalUsd,
  }) {
    emit(
      CartState(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: List.of(items),
        advertisementId: advertisementId,
        advertisementItemsSubtotalUsd: itemsSubtotalUsd,
        advertisementTotalUsd: totalUsd,
      ),
    );
    _loadWarehouseLimits(warehouseId);
  }

  void updateQuantity(String productId, int quantity) {
    final clamped = quantity < 1 ? 1 : quantity;
    final updated = state.items.map((item) {
      if (item.productId != productId) return item;
      return item.copyWith(quantity: clamped);
    }).toList();

    // A package line dropped BELOW its advertised quantity breaks the package
    // - the pharmacy would be short of what the package price covers, and the
    // backend rejects it at checkout (ADVERTISEMENT_ITEM_MISSING). Above the
    // advertised quantity nothing breaks: the discount is applied once and the
    // extra units add at the catalog price.
    final target = state.items.firstWhere(
      (item) => item.productId == productId,
      orElse: () => updated.first,
    );
    final breaksPackage = target.isAdvertised &&
        state.hasAdvertisement &&
        clamped < (target.advertisementQuantity ?? 1);

    emit(state.copyWith(items: updated, clearAdvertisement: breaksPackage));
  }

  void removeItem(String productId) {
    final removed = state.items.where((item) => item.productId == productId).toList();
    final updated = state.items.where((item) => item.productId != productId).toList();
    if (updated.isEmpty) {
      emit(const CartState());
      return;
    }

    // A package is all-or-nothing: dropping one of its products means the
    // package price no longer applies, and everything reprices normally. The
    // backend enforces the identical rule at checkout
    // (ADVERTISEMENT_ITEM_MISSING), so the cart can never show a package
    // price the server would refuse to honour.
    final brokePackage = removed.any((item) => item.isAdvertised);
    emit(state.copyWith(items: updated, clearAdvertisement: brokePackage));
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

    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      final order = await _orderRepository.submitOrder(
        warehouseId: state.warehouseId!,
        items: state.items,
        notes: state.notes.trim().isEmpty ? null : state.notes.trim(),
        // Only sent while the package still holds - hasAdvertisement goes
        // false the moment one of its products is removed, which is also when
        // the server would reject it.
        advertisementId: state.hasAdvertisement ? state.advertisementId : null,
      );
      emit(const CartState());
      return order;
    } on Failure catch (f) {
      emit(
        state.copyWith(
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
