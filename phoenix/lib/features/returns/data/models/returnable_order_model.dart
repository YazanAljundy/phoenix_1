// Section: a delivered order the pharmacy could still raise a return
// against - GET /orders/returnable (backend: order.service.js's
// listReturnableOrders). The server only ever returns orders that are
// genuinely still eligible, so there's no client-side filtering to redo.
class ReturnableOrderItemModel {
  const ReturnableOrderItemModel({
    required this.orderItemId,
    required this.productId,
    required this.productNameAr,
    this.productNameEn,
    required this.quantity,
    required this.discountPrice,
  });

  final String orderItemId;
  final String productId;
  final String productNameAr;
  final String? productNameEn;
  final int quantity;
  final num discountPrice;

  factory ReturnableOrderItemModel.fromJson(Map<String, dynamic> json) => ReturnableOrderItemModel(
    orderItemId: json['orderItemId'] as String,
    productId: json['productId'] as String,
    productNameAr: json['productNameAr'] as String,
    productNameEn: json['productNameEn'] as String?,
    quantity: json['quantity'] as int,
    discountPrice: json['discountPrice'] as num,
  );
}

class ReturnableOrderModel {
  const ReturnableOrderModel({
    required this.id,
    required this.orderNumber,
    required this.warehouseId,
    this.warehouseNameAr,
    this.warehouseNameEn,
    required this.finalPrice,
    required this.deliveredAt,
    required this.hoursRemaining,
    required this.items,
  });

  final String id;
  final int orderNumber;
  final String warehouseId;
  final String? warehouseNameAr;
  final String? warehouseNameEn;
  final num finalPrice;
  final DateTime deliveredAt;

  // Computed by the server, never recomputed here - the device clock can be
  // wrong, and the window it shows must match the one actually enforced.
  final int hoursRemaining;
  final List<ReturnableOrderItemModel> items;

  // Mirrors the card's "ending soon" treatment in the UI.
  bool get isEndingSoon => hoursRemaining < 12;

  factory ReturnableOrderModel.fromJson(Map<String, dynamic> json) => ReturnableOrderModel(
    id: json['id'] as String,
    orderNumber: json['orderNumber'] as int,
    warehouseId: json['warehouseId'] as String,
    warehouseNameAr: json['warehouseNameAr'] as String?,
    warehouseNameEn: json['warehouseNameEn'] as String?,
    finalPrice: json['finalPrice'] as num,
    deliveredAt: DateTime.parse(json['deliveredAt'] as String),
    hoursRemaining: json['hoursRemaining'] as int,
    items: (json['items'] as List)
        .map((e) => ReturnableOrderItemModel.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}
