// Section: matches GET /banners/active's deliberately minimal shape - just
// enough to render the slide and decide where a tap goes.
class BannerModel {
  const BannerModel({
    required this.id,
    required this.imageUrl,
    this.mediaType = 'image',
    this.productId,
    this.manufacturerAr,
    this.warehouseId,
  });

  final String id;
  final String imageUrl;

  // 'image' (default - every pre-existing banner, and every warehouse
  // banner), 'gif', or 'video'. Only an admin-published banner can ever be
  // 'gif'/'video' (see BannerSlider for how each is rendered).
  final String mediaType;
  final String? productId;
  final String? manufacturerAr;
  final String? warehouseId;

  bool get isVideo => mediaType == 'video';
  bool get isGif => mediaType == 'gif';

  // A tap only navigates when there's a real destination to send it to - a
  // product with no resolvable warehouse (e.g. an admin banner not tied to
  // one) has nowhere sensible to go, so it's treated the same as no product
  // at all (Section: "لو ما في productId: لا يصير شي").
  bool get isTappable => productId != null && manufacturerAr != null && warehouseId != null;

  factory BannerModel.fromJson(Map<String, dynamic> json) => BannerModel(
    id: json['id'] as String,
    imageUrl: json['imageUrl'] as String,
    mediaType: json['mediaType'] as String? ?? 'image',
    productId: json['productId'] as String?,
    manufacturerAr: json['manufacturerAr'] as String?,
    warehouseId: json['warehouseId'] as String?,
  );
}
