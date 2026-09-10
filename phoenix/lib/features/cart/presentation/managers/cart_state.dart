import 'package:feniq/features/cart/data/models/cart_item.dart';

class CartState {
  const CartState({
    this.warehouseId,
    this.warehouseName,
    this.minOrderAmountUsd = 0,
    this.maxOrderAmountUsd,
    this.items = const [],
    this.notes = '',
    this.isSubmitting = false,
    this.pendingIdempotencyKey,
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

  // Money-Flow V2 idempotency. Minted by CartCubit on the FIRST submit
  // attempt and deliberately kept across failed ones, so a retry reuses the
  // same key and the server can recognise it (order.service.js). It lives
  // here rather than as a cubit field so it survives exactly as long as the
  // cart does: every path that resets the cart to a fresh CartState - a
  // successful submit, clearCart, removing the last line, switching
  // warehouse - drops it too, which is precisely when a new order should get
  // a new key.
  final String? pendingIdempotencyKey;

  // Raw error pieces from the last failed action, kept separate rather than
  // pre-rendered: only the View has a BuildContext/l10n to translate `code`
  // (and `errorDetails.problems`, for STOCK_CHECK_FAILED) into the right
  // language - see core/error/error_translator.dart.
  final String? errorMessage;
  final String? errorCode;
  final Map<String, dynamic>? errorDetails;

  num get subtotalUsd => items.fold<num>(0, (sum, item) => sum + item.lineTotalUsd);

  /// The packages in the cart, as their own lines. Used by the repository to
  /// split the checkout payload, and by the summary to name them.
  List<CartItem> get packageLines => items.where((item) => item.isPackage).toList();

  bool get hasPackage => packageLines.isNotEmpty;

  /// What the pharmacist pays before the platform discount. A package line is
  /// already priced at its package price, so this is simply the subtotal -
  /// there is no separate package discount to subtract any more.
  ///
  /// The platform discount (warehouse.discountRate) is deliberately NOT
  /// modelled here - it never has been on this screen, and the server applies
  /// it on top at order time.
  num get payableUsd => subtotalUsd;

  // The limits are checked against the subtotal - the same figure the
  // backend compares (order.service.js), so this gate and the server's can
  // never disagree.
  bool get isBelowMinimum => minOrderAmountUsd > 0 && subtotalUsd < minOrderAmountUsd;
  bool get isAboveMaximum => maxOrderAmountUsd != null && subtotalUsd > maxOrderAmountUsd!;
  num get amountToReachMinimum => isBelowMinimum ? minOrderAmountUsd - subtotalUsd : 0;
  num get amountOverMaximum => isAboveMaximum ? subtotalUsd - maxOrderAmountUsd! : 0;
  bool get canSubmit => !isEmpty && !isBelowMinimum && !isAboveMaximum;
  /// The cart badge: how many LINES the cart holds, products and packages
  /// alike - a package counts once however many products are inside it, and
  /// however many copies of it were taken. Deliberately not the sum of the
  /// quantities: the badge answers "how many things are in my cart", and a
  /// package is one thing.
  int get itemCount => items.length;
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
    String? pendingIdempotencyKey,
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
      pendingIdempotencyKey: pendingIdempotencyKey ?? this.pendingIdempotencyKey,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      errorDetails: clearError ? null : (errorDetails ?? this.errorDetails),
    );
  }
}
