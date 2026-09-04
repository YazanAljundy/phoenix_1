import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
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
      _logDeliverySealState(order);
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
    } catch (e) {
      // Anything that isn't a Failure must still land in the error state -
      // otherwise this stays on OrderTrackingStatus.loading forever (a
      // spinner with no error ever shown).
      if (isClosed) return;
      emit(state.copyWith(status: OrderTrackingStatus.error, errorMessage: 'Unexpected error', errorCode: 'UNEXPECTED_ERROR'));
    }
  }

  // TEMPORARY DIAGNOSTIC (delivery-seal "UI not showing" report). Prints the
  // exact runtime state the DeliverySealSection visibility depends on, so it
  // is obvious whether the section is hidden because the order isn't
  // out_for_delivery, because the warehouse didn't enable the setting, or
  // because a field isn't reaching the client. Debug builds only; never logs
  // anything sensitive. Safe to delete once confirmed.
  void _logDeliverySealState(OrderModel order) {
    if (!kDebugMode) return;
    developer.log(
      'order ${order.id} status=${order.status} '
      'requiresDeliverySealPhoto=${order.requiresDeliverySealPhoto} '
      'deliverySealPhotoUrl=${order.deliverySealPhotoUrl} '
      'deliverySealConfirmedAt=${order.deliverySealConfirmedAt} '
      'needsDeliverySealConfirmation=${order.needsDeliverySealConfirmation}',
      name: 'DeliverySeal',
    );
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
    } catch (e) {
      // Ignored - see method comment (covers Failure and anything else).
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
    } catch (e) {
      // Anything that isn't a Failure must still land in a terminal state -
      // otherwise isCancelling stays true forever (a spinner with no error
      // ever shown - the "cancel order freezes" report this fixes).
      if (isClosed) return false;
      emit(state.copyWith(isCancelling: false, errorMessage: 'Unexpected error', errorCode: 'UNEXPECTED_ERROR'));
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
    } catch (e) {
      if (isClosed) return false;
      emit(state.copyWith(isSubmittingReview: false, errorMessage: 'Unexpected error', errorCode: 'UNEXPECTED_ERROR'));
      return false;
    }
  }

  // Section: optional delivery seal photo. Uploads the photo and records it on
  // the order; on success the order is patched in place with the server's
  // refreshed copy (which now carries deliverySealPhoto), so the tracking
  // screen flips straight to the confirmed state. The order status itself is
  // NOT changed - the warehouse still finalises it. On failure the order is
  // left untouched and the caller keeps the picked photo so the pharmacist can
  // retry. isClosed-guarded like every other emit here.
  Future<bool> confirmDelivery(XFile photo) async {
    emit(state.copyWith(isConfirmingDelivery: true, clearError: true));
    try {
      final order = await _orderRepository.confirmDeliveryWithSealPhoto(
        orderId: _orderId,
        sealPhoto: photo,
      );
      if (isClosed) return true;
      emit(state.copyWith(isConfirmingDelivery: false, order: order));
      return true;
    } on Failure catch (f) {
      if (isClosed) return false;
      emit(state.copyWith(isConfirmingDelivery: false, errorMessage: f.errMessage, errorCode: f.code));
      return false;
    } catch (e) {
      if (isClosed) return false;
      emit(state.copyWith(
        isConfirmingDelivery: false,
        errorMessage: 'Unexpected error',
        errorCode: 'UNEXPECTED_ERROR',
      ));
      return false;
    }
  }
}
