import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';

import 'order_tracking_state.dart';

// Depends on cart's OrderRepository/OrderModel rather than duplicating them:
// tracking is fetching/cancelling the exact same /orders resource cart just
// created, not a distinct domain concept.
class OrderTrackingCubit extends Cubit<OrderTrackingState> {
  OrderTrackingCubit({required OrderRepository orderRepository, required String orderId})
    : _orderRepository = orderRepository,
      _orderId = orderId,
      super(const OrderTrackingState());

  final OrderRepository _orderRepository;
  final String _orderId;

  Future<void> load() async {
    emit(state.copyWith(status: OrderTrackingStatus.loading));
    try {
      final order = await _orderRepository.getOrder(_orderId);
      emit(state.copyWith(status: OrderTrackingStatus.loaded, order: order));
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: OrderTrackingStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }

  Future<bool> cancel() async {
    emit(state.copyWith(isCancelling: true, clearError: true));
    try {
      final order = await _orderRepository.cancelOrder(_orderId);
      emit(state.copyWith(isCancelling: false, order: order));
      return true;
    } on Failure catch (f) {
      emit(state.copyWith(isCancelling: false, errorMessage: f.errMessage, errorCode: f.code));
      // The cancel window may have just closed server-side (e.g. the
      // warehouse moved it to out_for_delivery moments ago) - resync so a
      // stale cancel button doesn't linger.
      await load();
      return false;
    }
  }
}
