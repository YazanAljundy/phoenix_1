import 'package:feniq/features/cart/data/models/cart_item.dart';

class CartState {
  const CartState({
    this.warehouseId,
    this.warehouseName,
    this.minOrderAmountUsd = 0,
    this.maxOrderAmountUsd,
    this.limitsFetchedAt,
    this.isRefreshingLimits = false,
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

  // When the limits above were last confirmed current, so a cart left open
  // can tell whether they are worth re-reading on its own (see
  // CartCubit.limitsAreStale) rather than only when the cart screen itself
  // is opened. Null until the first successful read - a cart just bound to a
  // warehouse (or one whose only read has failed) counts as stale.
  final DateTime? limitsFetchedAt;

  // A limits re-read is in the air (CartCubit.refreshWarehouseLimits). The
  // cart keeps rendering its lines, its subtotal and the limits it already
  // has throughout - this only drives a small indicator beside the limit
  // line, and never gates the submit button: the values on screen are the
  // last ones the server gave, and order.service.js is the real gate.
  final bool isRefreshingLimits;

  final List<CartItem> items;
  final String notes;
  final bool isSubmitting;

  // Money-Flow V2 idempotency. Minted by CartCubit on the FIRST submit
  // attempt and deliberately kept across failed ones, so a retry of the SAME
  // cart reuses the same key and the server can recognise it
  // (order.service.js). It names one exact order request, so it lives only
  // as long as the cart's contents stay the same: every path that resets the
  // cart to a fresh CartState (a successful submit, clearCart, removing the
  // last line, switching warehouse, signing out) drops it, and so does every
  // edit that changes what would be sent (CartCubit passes
  // clearPendingIdempotencyKey).
  // A kept key on an edited cart used to make the server hand back the order
  // the unedited cart had already placed.
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

  /// Whether any line carries a server price change the pharmacist has not
  /// confirmed yet (CartItem.previousPriceUsd). CartCubit.submitOrder will not
  /// send the cart until it is confirmed.
  bool get hasUnconfirmedPriceChanges => items.any((item) => item.hasUnconfirmedPriceChange);

  /// Those changes in the shape of the server's PRICE_CHANGED
  /// `details.problems`, so CartView describes them with the very
  /// describePriceProblems it used for the refusal itself.
  List<Map<String, dynamic>> get unconfirmedPriceChanges => [
    for (final item in items)
      if (item.hasUnconfirmedPriceChange)
        {
          'code': 'PRICE_CHANGED',
          'productId': item.productId,
          'displayedPriceUsd': item.previousPriceUsd,
          'currentPriceUsd': item.discountPriceUsd,
        },
  ];

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
    DateTime? limitsFetchedAt,
    bool? isRefreshingLimits,
    List<CartItem>? items,
    String? notes,
    bool? isSubmitting,
    String? pendingIdempotencyKey,
    bool clearPendingIdempotencyKey = false,
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
      limitsFetchedAt: limitsFetchedAt ?? this.limitsFetchedAt,
      isRefreshingLimits: isRefreshingLimits ?? this.isRefreshingLimits,
      items: items ?? this.items,
      notes: notes ?? this.notes,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      pendingIdempotencyKey: clearPendingIdempotencyKey
          ? null
          : (pendingIdempotencyKey ?? this.pendingIdempotencyKey),
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      errorDetails: clearError ? null : (errorDetails ?? this.errorDetails),
    );
  }
}
