import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';

import 'my_orders_state.dart';

// Depends on cart's OrderRepository/OrderModel rather than duplicating them -
// same reasoning as OrderTrackingCubit: this is a list of the exact same
// /orders resource, not a distinct domain concept.
class MyOrdersCubit extends Cubit<MyOrdersState> {
  MyOrdersCubit({required OrderRepository orderRepository})
    : _orderRepository = orderRepository,
      super(const MyOrdersState());

  final OrderRepository _orderRepository;

  // Full reset - also what pull-to-refresh calls, so it always restarts
  // pagination from page one rather than just re-fetching whatever the
  // first page currently happens to be.
  Future<void> load() async {
    emit(
      state.copyWith(
        status: MyOrdersStatus.loading,
        clearError: true,
        hasMore: false,
        clearNextCursor: true,
      ),
    );
    try {
      final result = await _orderRepository.getOrders();
      emit(
        state.copyWith(
          status: MyOrdersStatus.loaded,
          orders: result.items,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
        ),
      );
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: MyOrdersStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }

  Future<void> loadMore() async {
    if (!state.hasMore || state.isLoadingMore || state.nextCursor == null) return;

    emit(state.copyWith(isLoadingMore: true, clearLoadMoreError: true));
    try {
      final result = await _orderRepository.getOrders(after: state.nextCursor);
      emit(
        state.copyWith(
          orders: [...state.orders, ...result.items],
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
          isLoadingMore: false,
        ),
      );
    } on Failure catch (f) {
      emit(state.copyWith(isLoadingMore: false, loadMoreErrorMessage: f.errMessage, loadMoreErrorCode: f.code));
    }
  }
}
