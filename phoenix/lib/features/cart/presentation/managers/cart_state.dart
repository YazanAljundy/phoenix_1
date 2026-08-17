import 'package:phoenix/features/cart/data/models/cart_item.dart';

class CartState {
  const CartState({
    this.warehouseId,
    this.warehouseName,
    this.items = const [],
    this.notes = '',
    this.isSubmitting = false,
    this.errorMessage,
    this.errorCode,
    this.errorDetails,
  });

  final String? warehouseId;
  final String? warehouseName;
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
  int get itemCount => items.fold<int>(0, (sum, item) => sum + item.quantity);
  bool get isEmpty => items.isEmpty;

  CartState copyWith({
    String? warehouseId,
    String? warehouseName,
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
      items: items ?? this.items,
      notes: notes ?? this.notes,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      errorDetails: clearError ? null : (errorDetails ?? this.errorDetails),
    );
  }
}
