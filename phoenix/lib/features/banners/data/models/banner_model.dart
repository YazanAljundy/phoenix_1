// Section: matches GET /banners/active's deliberately minimal shape - just
// enough to render the slide and decide where a tap goes.
class BannerModel {
  const BannerModel({
    required this.id,
    required this.imageUrl,
    this.productId,
    this.manufacturerAr,
    this.warehouseId,
  });

  final String id;
  final String imageUrl;
  final String? productId;
  final String? manufacturerAr;
  final String? warehouseId;

  // A tap only navigates when there's a real destination to send it to - a
  // product with no resolvable warehouse (e.g. an admin banner not tied to
  // one) has nowhere sensible to go, so it's treated the same as no product
  // at all (Section: "لو ما في productId: لا يصير شي").
  bool get isTappable => productId != null && manufacturerAr != null && warehouseId != null;

  factory BannerModel.fromJson(Map<String, dynamic> json) => BannerModel(
    id: json['id'] as String,
    imageUrl: json['imageUrl'] as String,
    productId: json['productId'] as String?,
    manufacturerAr: json['manufacturerAr'] as String?,
    warehouseId: json['warehouseId'] as String?,
  );
}
