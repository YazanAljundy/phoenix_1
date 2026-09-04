import 'package:phoenix/features/cart/data/models/cart_item.dart';

class CartState {
  const CartState({
    this.warehouseId,
    this.warehouseName,
    this.minOrderAmountUsd = 0,
    this.maxOrderAmountUsd,
    this.items = const [],
    this.notes = '',
    this.advertisementId,
    this.advertisementItemsSubtotalUsd = 0,
    this.advertisementTotalUsd = 0,
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
  // Section: advertisement packages. Set when the cart was loaded from one
  // (CartCubit.loadAdvertisement). Only the ID is ever sent at checkout - the
  // two totals below are for DISPLAY, so the pharmacist can see the package
  // price before submitting. order.service.js re-reads the package from
  // MongoDB and recomputes every figure, so a stale or tampered value here can
  // change what is shown but never what is charged.
  final String? advertisementId;
  final num advertisementItemsSubtotalUsd;
  final num advertisementTotalUsd;
  final bool isSubmitting;

  // Raw error pieces from the last failed action, kept separate rather than
  // pre-rendered: only the View has a BuildContext/l10n to translate `code`
  // (and `errorDetails.problems`, for STOCK_CHECK_FAILED) into the right
  // language - see core/error/error_translator.dart.
  final String? errorMessage;
  final String? errorCode;
  final Map<String, dynamic>? errorDetails;

  num get subtotalUsd => items.fold<num>(0, (sum, item) => sum + item.lineTotalUsd);

  /// True while the package still holds: the cart is bound to an advertisement
  /// AND every one of its products is still present. Removing one drops the
  /// package (see CartCubit.removeItem) - the backend enforces the same rule
  /// at checkout (ADVERTISEMENT_ITEM_MISSING), so the two can't disagree.
  bool get hasAdvertisement => advertisementId != null && items.any((item) => item.isAdvertised);

  /// What the package saves against the sum of its own advertised lines,
  /// applied once regardless of quantity. Clamped at zero - a package priced
  /// above its lines is allowed by the backend but is never a surcharge.
  num get advertisementDiscountUsd {
    if (!hasAdvertisement) return 0;
    final saving = advertisementItemsSubtotalUsd - advertisementTotalUsd;
    return saving > 0 ? saving : 0;
  }

  /// What the pharmacist actually pays: the lines, less the package discount.
  /// The platform discount (warehouse.discountRate) is deliberately NOT
  /// modelled here - it never has been on this screen, and the server applies
  /// it on top at order time.
  num get payableUsd => subtotalUsd - advertisementDiscountUsd;

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
    String? advertisementId,
    num? advertisementItemsSubtotalUsd,
    num? advertisementTotalUsd,
    bool clearAdvertisement = false,
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
      advertisementId: clearAdvertisement ? null : (advertisementId ?? this.advertisementId),
      advertisementItemsSubtotalUsd: clearAdvertisement
          ? 0
          : (advertisementItemsSubtotalUsd ?? this.advertisementItemsSubtotalUsd),
      advertisementTotalUsd: clearAdvertisement
          ? 0
          : (advertisementTotalUsd ?? this.advertisementTotalUsd),
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      errorDetails: clearError ? null : (errorDetails ?? this.errorDetails),
    );
  }
}
