import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

import 'cart_state.dart';

// Section 6.6: every order belongs to exactly one warehouse, so the cart as a
// whole is scoped to one warehouseId at a time. Registered globally (like
// AuthCubit) since it must survive navigation between the catalog and cart
// screens, and even a trip back to warehouse selection.
class CartCubit extends Cubit<CartState> {
  CartCubit({required OrderRepository orderRepository})
    : _orderRepository = orderRepository,
      super(const CartState());

  final OrderRepository _orderRepository;

  bool hasConflictingWarehouse(String warehouseId) =>
      state.items.isNotEmpty && state.warehouseId != warehouseId;

  void addProduct(
    ProductModel product, {
    required String warehouseId,
    required String warehouseName,
  }) {
    final existingIndex = state.items.indexWhere((item) => item.productId == product.id);
    final List<CartItem> updated;
    if (existingIndex >= 0) {
      final existing = state.items[existingIndex];
      updated = List.of(state.items)
        ..[existingIndex] = existing.copyWith(quantity: existing.quantity + 1);
    } else {
      updated = [...state.items, CartItem.fromProduct(product, quantity: 1)];
    }
    emit(
      state.copyWith(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: updated,
        clearError: true,
      ),
    );
  }

  // Used after the pharmacist confirms replacing a cart that has items from
  // a different warehouse (see hasConflictingWarehouse).
  void replaceWithProduct(
    ProductModel product, {
    required String warehouseId,
    required String warehouseName,
  }) {
    emit(
      CartState(
        warehouseId: warehouseId,
        warehouseName: warehouseName,
        items: [CartItem.fromProduct(product, quantity: 1)],
      ),
    );
  }

  void updateQuantity(String productId, int quantity) {
    final updated = state.items.map((item) {
      if (item.productId != productId) return item;
      return item.copyWith(quantity: quantity < 1 ? 1 : quantity);
    }).toList();
    emit(state.copyWith(items: updated));
  }

  void removeItem(String productId) {
    final updated = state.items.where((item) => item.productId != productId).toList();
    if (updated.isEmpty) {
      emit(const CartState());
    } else {
      emit(state.copyWith(items: updated));
    }
  }

  void updateNotes(String notes) => emit(state.copyWith(notes: notes));

  // Client-side availability snapshots (taken when items were added) can go
  // stale by the time the pharmacist actually submits - the server re-checks
  // isAvailable for real (Section 7/8) and this surfaces whatever
  // human-readable message it returns.
  Future<OrderModel?> submitOrder() async {
    if (state.items.isEmpty || state.warehouseId == null) return null;

    emit(state.copyWith(isSubmitting: true, clearError: true));
    try {
      final order = await _orderRepository.submitOrder(
        warehouseId: state.warehouseId!,
        items: state.items,
        notes: state.notes.trim().isEmpty ? null : state.notes.trim(),
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
    }
  }
}
