import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/reviews/data/repositories/review_repository.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository.dart';

import 'order_tracking_state.dart';

// Depends on cart's OrderRepository/OrderModel rather than duplicating them:
// tracking is fetching/cancelling the exact same /orders resource cart just
// created, not a distinct domain concept. ReviewRepository is reused too,
// for the same reason - submitting a rating here posts to the same /reviews
// resource the profile screen already reads from. WarehouseRepository is
// reused too - the order detail response doesn't carry the warehouse's
// phone (see order_tracking_state.dart), and getWarehouses() is already
// what the warehouse selection screen calls for the same data.
class OrderTrackingCubit extends Cubit<OrderTrackingState> {
  OrderTrackingCubit({
    required OrderRepository orderRepository,
    required ReviewRepository reviewRepository,
    required WarehouseRepository warehouseRepository,
    required String orderId,
  }) : _orderRepository = orderRepository,
       _reviewRepository = reviewRepository,
       _warehouseRepository = warehouseRepository,
       _orderId = orderId,
       super(const OrderTrackingState());

  final OrderRepository _orderRepository;
  final ReviewRepository _reviewRepository;
  final WarehouseRepository _warehouseRepository;
  final String _orderId;

  Future<void> load() async {
    emit(state.copyWith(status: OrderTrackingStatus.loading));
    try {
      final order = await _orderRepository.getOrder(_orderId);
      if (isClosed) return;
      emit(state.copyWith(status: OrderTrackingStatus.loaded, order: order));
      unawaited(_loadWarehousePhone(order.warehouseId));
    } on Failure catch (f) {
      if (isClosed) return;
      emit(
        state.copyWith(
          status: OrderTrackingStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }

  // Best-effort: the WhatsApp icon just doesn't show if this fails, so
  // errors here shouldn't surface an error dialog over an otherwise-loaded
  // tracking screen.
  Future<void> _loadWarehousePhone(String? warehouseId) async {
    if (warehouseId == null) return;
    try {
      final warehouses = await _warehouseRepository.getWarehouses();
      for (final warehouse in warehouses) {
        if (warehouse.id == warehouseId) {
          if (!isClosed) emit(state.copyWith(warehousePhone: warehouse.phone));
          return;
        }
      }
    } on Failure {
      // Ignored - see method comment.
    }
  }

  // Every emit below is guarded with isClosed - navigating away from the
  // tracking screen while this request is in flight (e.g. tapping back)
  // closes this cubit, and emitting after close throws (crashes the whole
  // app on web) rather than silently no-op-ing.
  Future<bool> cancel() async {
    emit(state.copyWith(isCancelling: true, clearError: true));
    try {
      final order = await _orderRepository.cancelOrder(_orderId);
      if (isClosed) return true;
      emit(state.copyWith(isCancelling: false, order: order));
      return true;
    } on Failure catch (f) {
      if (isClosed) return false;
      emit(state.copyWith(isCancelling: false, errorMessage: f.errMessage, errorCode: f.code));
      // The cancel window may have just closed server-side (e.g. the
      // warehouse moved it to out_for_delivery moments ago) - resync so a
      // stale cancel button doesn't linger.
      await load();
      return false;
    }
  }

  // Rates the warehouse for this (delivered) order. On success the loaded
  // order is patched in place with the new myReview rather than re-fetched -
  // the tracking screen should flip to the "thanks" display immediately,
  // not wait on a full reload.
  Future<bool> submitReview({required int rating, String? comment}) async {
    final order = state.order;
    if (order == null || order.warehouseId == null) return false;

    emit(state.copyWith(isSubmittingReview: true, clearError: true));
    try {
      final review = await _reviewRepository.submitWarehouseReview(
        orderId: order.id,
        warehouseId: order.warehouseId!,
        rating: rating,
        comment: comment,
      );
      if (isClosed) return true;
      emit(
        state.copyWith(
          isSubmittingReview: false,
          order: order.copyWith(
            myReview: MyReviewModel(
              id: review.id,
              rating: review.rating,
              comment: review.comment,
              createdAt: review.createdAt,
            ),
          ),
        ),
      );
      return true;
    } on Failure catch (f) {
      if (isClosed) return false;
      emit(state.copyWith(isSubmittingReview: false, errorMessage: f.errMessage, errorCode: f.code));
      return false;
    }
  }
}
