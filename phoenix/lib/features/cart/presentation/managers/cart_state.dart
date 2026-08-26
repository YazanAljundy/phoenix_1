import 'package:phoenix/features/cart/data/models/cart_item.dart';

class CartState {
  const CartState({
    this.warehouseId,
    this.warehouseName,
    this.minOrderAmountUsd = 0,
    this.maxOrderAmountUsd,
    this.items = const [],
    this.notes = '',
    this.isSubmitting = false,
    this.errorMessage,
    this.errorCode,
    this.errorDetails,
  });

  final String? warehouseId;
  final String? warehouseName;
  // This warehouse's order-size limits, loaded alongside the cart (see
  // CartCubit._loadWarehouseLimits). 0 = no minimum, null = no maximum -
  // which is also what they stay as if the lookup fails, so a network
  // hiccup can never block ordering: order.service.js re-checks anyway.
  final num minOrderAmountUsd;
  final num? maxOrderAmountUsd;
  final List<CartItem> items;
  final String notes;
  final bool isSubmitting;

  // Raw error pieces from the last failed action, kept separate rather than
  // pre-rendered: only the View has a BuildContext/l10n to translate `code`
  // (and `errorDetails.problems`, for STOCK_CHECK_FAILED) into the right
  // language - see core/error/error_translator.dart.
  final String? errorMessage;
  final String? errorCode;
  final Map<String, dynamic>? errorDetails;

  num get subtotalUsd => items.fold<num>(0, (sum, item) => sum + item.lineTotalUsd);

  // The limits are checked against the subtotal - the same figure the
  // backend compares (order.service.js), so this gate and the server's can
  // never disagree.
  bool get isBelowMinimum => minOrderAmountUsd > 0 && subtotalUsd < minOrderAmountUsd;
  bool get isAboveMaximum => maxOrderAmountUsd != null && subtotalUsd > maxOrderAmountUsd!;
  num get amountToReachMinimum => isBelowMinimum ? minOrderAmountUsd - subtotalUsd : 0;
  num get amountOverMaximum => isAboveMaximum ? subtotalUsd - maxOrderAmountUsd! : 0;
  bool get canSubmit => !isEmpty && !isBelowMinimum && !isAboveMaximum;
  int get itemCount => items.fold<int>(0, (sum, item) => sum + item.quantity);
  bool get isEmpty => items.isEmpty;

  CartState copyWith({
    String? warehouseId,
    String? warehouseName,
    num? minOrderAmountUsd,
    num? maxOrderAmountUsd,
    bool clearMaxOrderAmount = false,
    List<CartItem>? items,
    String? notes,
    bool? isSubmitting,
    String? errorMessage,
    String? errorCode,
    Map<String, dynamic>? errorDetails,
    bool clearError = false,
  }) {
    return CartState(
      warehouseId: warehouseId ?? this.warehouseId,
      warehouseName: warehouseName ?? this.warehouseName,
      minOrderAmountUsd: minOrderAmountUsd ?? this.minOrderAmountUsd,
      maxOrderAmountUsd: clearMaxOrderAmount ? null : (maxOrderAmountUsd ?? this.maxOrderAmountUsd),
      items: items ?? this.items,
      notes: notes ?? this.notes,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      errorDetails: clearError ? null : (errorDetails ?? this.errorDetails),
    );
  }
}
