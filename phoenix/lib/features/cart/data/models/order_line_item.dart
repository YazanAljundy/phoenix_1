// A snapshotted invoice line - name/manufacturer/price exactly as they were
// at order time (see orderItem.model.js on the backend), not a live product
// lookup. Only present on the detail fetch (GET /orders/:id).
class OrderLineItem {
  const OrderLineItem({
    required this.id,
    required this.productId,
    required this.productNameAr,
    this.productNameEn,
    required this.manufacturerAr,
    this.manufacturerEn,
    required this.quantity,
    required this.unitPrice,
    required this.discountPrice,
    required this.lineTotal,
    this.savingsUsd,
  });

  // The underlying OrderItem's own id - what a return request references
  // (see features/returns), distinct from productId.
  final String id;
  final String productId;
  final String productNameAr;
  // Section 14 Part 2: null when the linked catalog entry had no English
  // name at order time - see orderItem.model.js. Fall back to the Arabic
  // value when displaying, never render blank.
  final String? productNameEn;
  final String manufacturerAr;
  final String? manufacturerEn;
  final int quantity;
  final num unitPrice;
  final num discountPrice;
  final num lineTotal;
  // Section 15: USD, not SYP (deliberately, unlike the price fields above) -
  // how much this line saved vs. its undiscounted unitPrice, from any
  // stacked product Offer + manufacturer discount combined. Null/0 for an
  // order placed before Section 15, or a line nothing discounted - either
  // way, no "you saved" line to show.
  final num? savingsUsd;

  bool get hasOffer => discountPrice != unitPrice;

  factory OrderLineItem.fromJson(Map<String, dynamic> json) => OrderLineItem(
    id: json['id'] as String,
    productId: json['productId'] as String,
    productNameAr: json['productNameAr'] as String,
    productNameEn: json['productNameEn'] as String?,
    manufacturerAr: json['manufacturerAr'] as String,
    manufacturerEn: json['manufacturerEn'] as String?,
    quantity: json['quantity'] as int,
    unitPrice: json['unitPrice'] as num,
    discountPrice: json['discountPrice'] as num,
    lineTotal: json['lineTotal'] as num,
    savingsUsd: json['savingsUsd'] as num?,
  );
}
