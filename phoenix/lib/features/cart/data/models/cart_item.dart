import 'package:phoenix/features/catalog/data/models/product_model.dart';

// A locally-held line item: what's already in ProductModel, plus the
// quantity the pharmacist has chosen. Deliberately depends on catalog's
// ProductModel (one-directional) rather than duplicating every field as a
// bare parameter list.
class CartItem {
  const CartItem({
    required this.productId,
    required this.nameAr,
    required this.nameEn,
    required this.manufacturerAr,
    required this.manufacturerEn,
    this.image,
    required this.unitAr,
    required this.unitEn,
    required this.unitPrice,
    required this.discountPrice,
    required this.stockQuantity,
    required this.quantity,
  });

  final String productId;
  final String nameAr;
  final String nameEn;
  final String manufacturerAr;
  final String manufacturerEn;
  final String? image;
  final String unitAr;
  final String unitEn;
  final num unitPrice;
  final num discountPrice;
  final int stockQuantity;
  final int quantity;

  bool get hasOffer => discountPrice != unitPrice;
  num get lineTotal => discountPrice * quantity;

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
      unitPrice: product.price,
      discountPrice: product.offer?.discountPrice ?? product.price,
      stockQuantity: product.stockQuantity,
      quantity: quantity,
    );
  }

  CartItem copyWith({int? quantity}) {
    return CartItem(
      productId: productId,
      nameAr: nameAr,
      nameEn: nameEn,
      manufacturerAr: manufacturerAr,
      manufacturerEn: manufacturerEn,
      image: image,
      unitAr: unitAr,
      unitEn: unitEn,
      unitPrice: unitPrice,
      discountPrice: discountPrice,
      stockQuantity: stockQuantity,
      quantity: quantity ?? this.quantity,
    );
  }
}
