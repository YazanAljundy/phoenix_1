import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';

import 'request_return_state.dart';

const int kMaxReturnPhotos = 5;

// Section 6.9: one sheet, two modes. `existingReturn == null` submits a new
// return for the order; otherwise this edits that (still-pending) return in
// place. Depends on cart's OrderRepository (same precedent as
// OrderTrackingCubit) to load the order's full item list, since editing must
// be able to broaden the return to items not originally selected.
class RequestReturnCubit extends Cubit<RequestReturnState> {
  RequestReturnCubit({
    required ReturnRepository returnRepository,
    required OrderRepository orderRepository,
    required this.orderId,
    this.existingReturn,
  }) : _returnRepository = returnRepository,
       _orderRepository = orderRepository,
       super(const RequestReturnState());

  final ReturnRepository _returnRepository;
  final OrderRepository _orderRepository;
  final String orderId;
  final ReturnModel? existingReturn;

  bool get isEditing => existingReturn != null;

  Future<void> initialize() async {
    try {
      final order = await _orderRepository.getOrder(orderId);

      final existing = existingReturn;
      final selectedItemIds = <String>{};
      final itemQuantity = <String, int>{};
      final itemReasonType = <String, String>{};
      final itemCustomReason = <String, String>{};
      if (existing != null) {
        for (final item in existing.items) {
          selectedItemIds.add(item.orderItemId);
          itemQuantity[item.orderItemId] = item.quantity;
          itemReasonType[item.orderItemId] = item.reasonType;
          itemCustomReason[item.orderItemId] = item.customReason ?? '';
        }
      }

      emit(
        state.copyWith(
          status: RequestReturnStatus.editing,
          orderItems: order.items,
          selectedItemIds: selectedItemIds,
          itemQuantity: itemQuantity,
          itemReasonType: itemReasonType,
          itemCustomReason: itemCustomReason,
          notes: existing?.notes ?? '',
          existingImageUrls: existing?.images ?? const [],
        ),
      );
    } on Failure catch (f) {
      emit(state.copyWith(status: RequestReturnStatus.error, errorMessage: f.errMessage, errorCode: f.code));
    }
  }

  void toggleItem(String orderItemId) {
    final selected = {...state.selectedItemIds};
    if (selected.contains(orderItemId)) {
      selected.remove(orderItemId);
    } else {
      selected.add(orderItemId);
    }
    final quantity = {...state.itemQuantity};
    quantity.putIfAbsent(orderItemId, () => 1);
    final reason = {...state.itemReasonType};
    reason.putIfAbsent(orderItemId, () => kReturnReasonTypes.first);

    emit(state.copyWith(selectedItemIds: selected, itemQuantity: quantity, itemReasonType: reason));
  }

  void setItemQuantity(String orderItemId, int quantity) {
    final maxQuantity = state.orderItems
        .firstWhere((item) => item.id == orderItemId)
        .quantity;
    if (quantity < 1 || quantity > maxQuantity) return;
    emit(state.copyWith(itemQuantity: {...state.itemQuantity, orderItemId: quantity}));
  }

  void setItemReasonType(String orderItemId, String reasonType) {
    emit(state.copyWith(itemReasonType: {...state.itemReasonType, orderItemId: reasonType}));
  }

  void setItemCustomReason(String orderItemId, String value) {
    emit(state.copyWith(itemCustomReason: {...state.itemCustomReason, orderItemId: value}));
  }

  void setNotes(String value) {
    emit(state.copyWith(notes: value));
  }

  void addImages(List<XFile> picked) {
    final totalExisting = state.existingImageUrls.length + state.newImages.length;
    final remaining = kMaxReturnPhotos - totalExisting;
    if (remaining <= 0) return;
    final capped = picked.length > remaining ? picked.sublist(0, remaining) : picked;
    emit(state.copyWith(newImages: [...state.newImages, ...capped]));
  }

  void removeNewImageAt(int index) {
    final updated = [...state.newImages]..removeAt(index);
    emit(state.copyWith(newImages: updated));
  }

  void removeExistingImage(String url) {
    emit(state.copyWith(existingImageUrls: state.existingImageUrls.where((u) => u != url).toList()));
  }

  // Section 7: reasonType='other' is the only case that requires elaboration.
  bool get isValid {
    if (state.selectedItemIds.isEmpty) return false;
    for (final orderItemId in state.selectedItemIds) {
      final reason = state.itemReasonType[orderItemId];
      if (reason == null) return false;
      if (reason == 'other' && (state.itemCustomReason[orderItemId] ?? '').trim().isEmpty) {
        return false;
      }
    }
    return true;
  }

  Future<ReturnModel?> submit() async {
    if (!isValid) return null;

    emit(state.copyWith(status: RequestReturnStatus.submitting, clearError: true));
    try {
      final items = state.selectedItemIds
          .map(
            (orderItemId) => ReturnItemInput(
              orderItemId: orderItemId,
              quantity: state.itemQuantity[orderItemId]!,
              reasonType: state.itemReasonType[orderItemId]!,
              customReason: state.itemReasonType[orderItemId] == 'other'
                  ? state.itemCustomReason[orderItemId]?.trim()
                  : null,
            ),
          )
          .toList();

      final result = isEditing
          ? await _returnRepository.updateReturn(
              returnId: existingReturn!.id,
              items: items,
              notes: state.notes.trim().isEmpty ? null : state.notes.trim(),
              keepImageUrls: state.existingImageUrls,
              newImages: state.newImages,
            )
          : await _returnRepository.createReturn(
              orderId: orderId,
              items: items,
              notes: state.notes.trim().isEmpty ? null : state.notes.trim(),
              images: state.newImages,
            );

      emit(state.copyWith(status: RequestReturnStatus.submitted));
      return result;
    } on Failure catch (f) {
      emit(
        state.copyWith(
          status: RequestReturnStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
      return null;
    }
  }
}
