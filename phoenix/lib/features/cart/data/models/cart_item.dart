import 'package:feniq/features/catalog/data/models/product_model.dart';

/// One product inside a package, for the package line's expandable detail.
///
/// Display only: the server builds the real order lines from the package
/// itself, so nothing here is ever sent back or priced against.
class CartPackageContent {
  const CartPackageContent({
    required this.productId,
    required this.nameAr,
    this.nameEn,
    required this.quantityPerCopy,
  });

  final String productId;
  final String nameAr;
  final String? nameEn;

  /// Units of this product in ONE copy of the package. The tile shows
  /// `quantityPerCopy * copies` so the pharmacist can see what is actually
  /// coming.
  final int quantityPerCopy;

  String name(bool isArabic) => isArabic ? nameAr : (nameEn ?? nameAr);
}

/// A line in the cart. It is either an ordinary product or a whole package,
/// and the cart treats the two exactly alike: one line, one quantity, one
/// line total. [isPackage] is the only thing that tells them apart.
///
/// For a package line:
///   - [quantity] is the number of COPIES of the package,
///   - [discountPriceUsd] is the price of ONE copy,
///   - so [lineTotalUsd] is the package price times copies, with no special
///     case anywhere,
///   - and [productId] holds the package's own id (see [lineKey]).
///
/// The products inside a package are NOT separate cart lines. They are carried
/// in [packageContents] for display, and the server derives the real order
/// lines from the package when the order is placed - the client never prices
/// them and never sends them.
class CartItem {
  const CartItem({
    required this.productId,
    required this.nameAr,
    this.nameEn,
    required this.manufacturerAr,
    this.manufacturerEn,
    this.image,
    this.unitAr,
    this.unitEn,
    required this.unitPriceUsd,
    required this.discountPriceUsd,
    required this.quantity,
    this.packageId,
    this.packageContents = const [],
    this.isAvailable = true,
    this.previousPriceUsd,
  });

  /// A product's id on an ordinary line; the PACKAGE's id on a package line.
  /// Either way it is what identifies the line - see [lineKey].
  final String productId;
  final String nameAr;
  final String? nameEn;
  final String manufacturerAr;
  final String? manufacturerEn;
  final String? image;
  final String? unitAr;
  final String? unitEn;
  final num unitPriceUsd;

  /// What one unit of this line costs: a product's price after any offer, or
  /// one copy of a package.
  final num discountPriceUsd;

  /// Units for a product line, COPIES for a package line.
  final int quantity;

  /// Set only on a package line, and the one field that marks it as one.
  final String? packageId;

  /// What one copy of the package contains. Empty on a product line.
  final List<CartPackageContent> packageContents;

  /// Whether this line can still be bought. Only ever false on a PACKAGE line
  /// the server has reported as paused (by its warehouse or an admin) after it
  /// went into the cart. The line stays - so the pharmacist sees what happened
  /// and chooses to remove it - and the tile shows a warning. Nothing here
  /// blocks checkout: the server is what refuses it (PACKAGE_UNAVAILABLE).
  final bool isAvailable;

  /// The unit price the pharmacist was looking at before the server repriced
  /// this line (a PRICE_CHANGED refusal - see CartCubit). Non-null means the
  /// new price has not been confirmed yet, and CartCubit will not send the
  /// cart until it is. Null on every line the server has not repriced.
  final num? previousPriceUsd;

  bool get isPackage => packageId != null;

  bool get hasUnconfirmedPriceChange => previousPriceUsd != null;

  /// A package has no "was" price to strike through - its price IS the offer.
  bool get hasOffer => !isPackage && discountPriceUsd != unitPriceUsd;

  /// Identifies the line for the cubit's add/update/remove. A product id and a
  /// package id can never collide, so this is unique across a cart holding
  /// both.
  String get lineKey => productId;

  num get lineTotalUsd => discountPriceUsd * quantity;

  factory CartItem.fromProduct(ProductModel product, {required int quantity}) {
    return CartItem(
      productId: product.id,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      manufacturerAr: product.manufacturerAr,
      manufacturerEn: product.manufacturerEn,
      image: product.image,
      unitAr: product.unitAr,
      unitEn: product.unitEn,
      unitPriceUsd: product.priceUsd,
      discountPriceUsd: product.discountPriceUsd,
      quantity: quantity,
    );
  }

  /// A package as a single cart line. [pricePerCopyUsd] is the package's own
  /// total - the figure the pharmacy pays for one copy - and is what the line
  /// is priced at; `manufacturerAr` carries the warehouse name so the tile has
  /// a subtitle without a second shape to parse.
  factory CartItem.fromPackage({
    required String packageId,
    required String titleAr,
    String? titleEn,
    required String warehouseName,
    String? image,
    required num pricePerCopyUsd,
    required int copies,
    required List<CartPackageContent> contents,
    bool isAvailable = true,
  }) {
    return CartItem(
      productId: packageId,
      packageId: packageId,
      nameAr: titleAr,
      nameEn: titleEn,
      manufacturerAr: warehouseName,
      image: image,
      unitPriceUsd: pricePerCopyUsd,
      discountPriceUsd: pricePerCopyUsd,
      quantity: copies,
      packageContents: contents,
      isAvailable: isAvailable,
    );
  }

  /// The prices are settable so the server's PRICE_CHANGED figures can reach a
  /// line (CartCubit); `clearPreviousPrice` drops [previousPriceUsd] once the
  /// pharmacist has confirmed the new price.
  CartItem copyWith({
    int? quantity,
    bool? isAvailable,
    num? unitPriceUsd,
    num? discountPriceUsd,
    num? previousPriceUsd,
    bool clearPreviousPrice = false,
  }) {
    return CartItem(
      productId: productId,
      nameAr: nameAr,
      nameEn: nameEn,
      manufacturerAr: manufacturerAr,
      manufacturerEn: manufacturerEn,
      image: image,
      unitAr: unitAr,
      unitEn: unitEn,
      unitPriceUsd: unitPriceUsd ?? this.unitPriceUsd,
      discountPriceUsd: discountPriceUsd ?? this.discountPriceUsd,
      quantity: quantity ?? this.quantity,
      packageId: packageId,
      packageContents: packageContents,
      isAvailable: isAvailable ?? this.isAvailable,
      previousPriceUsd: clearPreviousPrice ? null : (previousPriceUsd ?? this.previousPriceUsd),
    );
  }
}
