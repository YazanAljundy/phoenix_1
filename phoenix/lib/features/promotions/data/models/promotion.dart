import 'package:feniq/features/advertisements/data/models/advertisement_model.dart';
import 'package:feniq/features/offers/data/models/offer_model.dart';

/// The two things the Offers & Ads tab browses: a product-level [Offer]
/// discount and a warehouse [Package] (an advertisement).
enum PromotionKind { offer, package }

/// A thin read-only wrapper that lets one list, one carousel and one filter
/// hold both kinds at once.
///
/// It owns no data of its own and computes no prices - every value below is
/// read straight off the model the API already returns. The models themselves
/// are untouched; this only gives the two of them the small common surface a
/// shared card needs (a title, a warehouse, a headline saving figure).
sealed class Promotion {
  const Promotion();

  PromotionKind get kind;

  /// Unique within a promotions list. An offer id and an advertisement id come
  /// from different collections and could in principle collide, so the kind is
  /// part of the key.
  String get key => '${kind.name}:$id';

  String get id;
  String get warehouseId;

  /// The saving the pharmacist is being shown, as a whole percent. Used for
  /// the headline figure and to rank which promotions make the carousel.
  int get savingPercentage;

  /// Localized display text. `isArabic` is passed in rather than read from a
  /// BuildContext so these stay usable (and testable) outside a widget tree.
  String title(bool isArabic);
  String warehouseName(bool isArabic);

  /// The card's image, when there is one. Null renders the app's standard
  /// themed placeholder (see AppNetworkImage) - most catalog products carry no
  /// image yet, so a promotion card must read well without one.
  String? get imageUrl;
}

class OfferPromotion extends Promotion {
  const OfferPromotion(this.offer);

  final OfferModel offer;

  @override
  PromotionKind get kind => PromotionKind.offer;

  @override
  String get id => offer.id;

  @override
  String get warehouseId => offer.warehouseId;

  @override
  int get savingPercentage => offer.discountPercentage;

  @override
  String title(bool isArabic) =>
      isArabic ? offer.titleAr : (offer.titleEn ?? offer.titleAr);

  @override
  String warehouseName(bool isArabic) =>
      isArabic ? offer.warehouseNameAr : (offer.warehouseNameEn ?? offer.warehouseNameAr);

  @override
  String? get imageUrl => offer.image;

  /// The discounted product's own name - the offer's subtitle, and what the
  /// pharmacist is really looking for.
  String productName(bool isArabic) =>
      isArabic ? offer.nameAr : (offer.nameEn ?? offer.nameAr);
}

class PackagePromotion extends Promotion {
  const PackagePromotion(this.advertisement);

  final AdvertisementModel advertisement;

  @override
  PromotionKind get kind => PromotionKind.package;

  @override
  String get id => advertisement.id;

  @override
  String get warehouseId => advertisement.warehouseId;

  @override
  int get savingPercentage => advertisement.savingPercentage;

  @override
  String title(bool isArabic) =>
      isArabic ? advertisement.titleAr : (advertisement.titleEn ?? advertisement.titleAr);

  @override
  String warehouseName(bool isArabic) => isArabic
      ? advertisement.warehouseNameAr
      : (advertisement.warehouseNameEn ?? advertisement.warehouseNameAr);

  /// The package's own image when it has one; otherwise the first item that
  /// actually has one, since older packages (or ones the warehouse never
  /// attached a photo to) carry no image of their own, only their products'.
  @override
  String? get imageUrl {
    final packageImage = advertisement.imageUrl;
    if (packageImage != null && packageImage.trim().isNotEmpty) return packageImage;
    for (final item in advertisement.items) {
      final image = item.image;
      if (image != null && image.trim().isNotEmpty) return image;
    }
    return null;
  }
}

/// One entry in the warehouse filter, derived from the promotions on screen
/// rather than fetched: the only warehouses worth offering as a filter are the
/// ones that actually have something running.
class PromotionWarehouse {
  const PromotionWarehouse({
    required this.id,
    required this.nameAr,
    required this.nameEn,
  });

  final String id;
  final String nameAr;
  final String? nameEn;

  String name(bool isArabic) => isArabic ? nameAr : (nameEn ?? nameAr);
}
