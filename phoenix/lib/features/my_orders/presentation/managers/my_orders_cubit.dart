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

  Future<void> load() async {
    emit(state.copyWith(status: MyOrdersStatus.loading, clearError: true));
    try {
      final orders = await _orderRepository.getOrders();
      emit(state.copyWith(status: MyOrdersStatus.loaded, orders: orders));
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
}
