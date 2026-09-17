import 'package:feniq/features/catalog/data/models/product_model.dart';

/// One currently-running product offer, as GET /offers/active returns it.
///
/// The server only ever sends approved offers inside their own date window
/// (permanent ones included), so there is no client-side expiry or approval
/// filtering to get wrong - the same rule the catalog already applies.
///
/// USD here, like every other price crossing the API (see backend
/// product.model.js). SYP is derived for display through the app's one
/// existing formatter, core/utils/currency_formatter.dart.
class OfferModel {
  const OfferModel({
    required this.id,
    required this.titleAr,
    this.titleEn,
    required this.discountPercentage,
    this.endDate,
    required this.isPermanent,
    required this.warehouseId,
    required this.warehouseNameAr,
    this.warehouseNameEn,
    required this.productId,
    required this.nameAr,
    this.nameEn,
    required this.manufacturerAr,
    this.manufacturerEn,
    this.image,
    this.unitAr,
    this.unitEn,
    required this.priceUsd,
    required this.discountPriceUsd,
    required this.isAvailable,
  });

  final String id;
  final String titleAr;
  final String? titleEn;
  final int discountPercentage;
  // Null on a permanent offer - `isPermanent` is what the UI checks, so it
  // never has to infer "no expiry" from a missing date.
  final DateTime? endDate;
  final bool isPermanent;

  final String warehouseId;
  final String warehouseNameAr;
  final String? warehouseNameEn;

  final String productId;
  final String nameAr;
  final String? nameEn;
  // What the app navigates into the existing warehouse -> manufacturer ->
  // catalog flow with, exactly as a tapped banner does.
  final String manufacturerAr;
  final String? manufacturerEn;
  final String? image;
  final String? unitAr;
  final String? unitEn;

  // The product's list price.
  final num priceUsd;
  // The price the pharmacist actually pays: the offer AND the warehouse's
  // manufacturer discount already stacked in, server-computed by the very
  // function the catalog listing uses. This is the one number to render, and
  // it is the same figure the catalog card shows for the same product.
  final num discountPriceUsd;
  final bool isAvailable;

  /// What the offer saves against the list price. Clamped at zero - a
  /// discounted price at or above the list price just means "no saving".
  num get savingUsd {
    final saving = priceUsd - discountPriceUsd;
    return saving > 0 ? saving : 0;
  }

  bool get hasSaving => discountPriceUsd < priceUsd;

  /// The discounted product as the catalog's own [ProductModel], so an offer
  /// can go into the cart through the very same path a catalog product does
  /// (CartCubit.addProduct -> CartItem.fromProduct) instead of a second
  /// offer-shaped one.
  ///
  /// Nothing is computed here - the offer listing already carries every field
  /// the catalog listing does, priced by the same server function - and in
  /// particular [discountPriceUsd] stays the price the pharmacist pays, so the
  /// cart line is the offer price and never the list price.
  ///
  /// [id] is the PRODUCT's id, not the offer's: it is what identifies a cart
  /// line (CartItem.lineKey), so the same product added from here and from the
  /// catalog lands on one line rather than two. `categoryId` is null because
  /// the offer listing does not carry one; nothing on the cart path reads it.
  ProductModel toCartProduct() => ProductModel(
    id: productId,
    nameAr: nameAr,
    nameEn: nameEn,
    manufacturerAr: manufacturerAr,
    manufacturerEn: manufacturerEn,
    image: image,
    unitAr: unitAr,
    unitEn: unitEn,
    priceUsd: priceUsd,
    discountPriceUsd: discountPriceUsd,
    isAvailable: isAvailable,
    // It is an offer, by construction.
    hasActiveOffer: true,
  );

  factory OfferModel.fromJson(Map<String, dynamic> json) => OfferModel(
    id: json['id'] as String,
    titleAr: (json['titleAr'] as String?) ?? '',
    titleEn: json['titleEn'] as String?,
    discountPercentage: (json['discountPercentage'] as num?)?.round() ?? 0,
    endDate: json['endDate'] == null ? null : DateTime.tryParse(json['endDate'] as String),
    isPermanent: (json['isPermanent'] as bool?) ?? false,
    warehouseId: json['warehouseId'] as String,
    warehouseNameAr: (json['warehouseNameAr'] as String?) ?? '',
    warehouseNameEn: json['warehouseNameEn'] as String?,
    productId: json['productId'] as String,
    nameAr: (json['nameAr'] as String?) ?? '',
    nameEn: json['nameEn'] as String?,
    manufacturerAr: (json['manufacturerAr'] as String?) ?? '',
    manufacturerEn: json['manufacturerEn'] as String?,
    image: json['image'] as String?,
    unitAr: json['unitAr'] as String?,
    unitEn: json['unitEn'] as String?,
    priceUsd: json['priceUsd'] as num,
    // Falls back to the list price if an older server omits it, so a card
    // never renders a blank or a zero price.
    discountPriceUsd: (json['discountPriceUsd'] as num?) ?? (json['priceUsd'] as num),
    isAvailable: (json['isAvailable'] as bool?) ?? false,
  );
}
