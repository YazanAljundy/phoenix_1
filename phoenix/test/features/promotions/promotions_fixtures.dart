import 'package:feniq/features/advertisements/data/models/advertisement_model.dart';
import 'package:feniq/features/offers/data/models/offer_model.dart';

// Shared builders for the Offers & Ads tests. Both go through the models'
// own fromJson so the fixtures exercise the same parsing the app does.

OfferModel offer({
  String id = 'o1',
  String warehouseId = 'W1',
  String warehouseNameEn = 'Warehouse One',
  String titleEn = 'Winter offer',
  String productNameEn = 'Panadol',
  String manufacturerAr = 'شركة',
  int discountPercentage = 20,
  num priceUsd = 10,
  num? discountPriceUsd,
  bool isAvailable = true,
  bool isPermanent = false,
  String? endDate = '2026-12-31T00:00:00.000Z',
}) {
  return OfferModel.fromJson({
    'id': id,
    'titleAr': 'عرض $id',
    'titleEn': titleEn,
    'discountPercentage': discountPercentage,
    'endDate': isPermanent ? null : endDate,
    'isPermanent': isPermanent,
    'warehouseId': warehouseId,
    'warehouseNameAr': 'مستودع $warehouseId',
    'warehouseNameEn': warehouseNameEn,
    'productId': 'p-$id',
    'nameAr': 'دواء $id',
    'nameEn': productNameEn,
    'manufacturerAr': manufacturerAr,
    'manufacturerEn': 'Pharma',
    'image': null,
    'unitAr': 'علبة',
    'unitEn': 'box',
    'priceUsd': priceUsd,
    'discountPriceUsd':
        discountPriceUsd ?? (priceUsd * (1 - discountPercentage / 100)),
    'isAvailable': isAvailable,
  });
}

AdvertisementModel advertisement({
  String id = 'a1',
  String warehouseId = 'W1',
  String warehouseNameEn = 'Warehouse One',
  String titleEn = 'Family package',
  int savingPercentage = 20,
  num itemsTotalUsd = 100,
  num totalPriceUsd = 80,
  int itemCount = 2,
}) {
  return AdvertisementModel.fromJson({
    'id': id,
    'titleAr': 'باقة $id',
    'titleEn': titleEn,
    'warehouseId': warehouseId,
    'warehouseNameAr': 'مستودع $warehouseId',
    'warehouseNameEn': warehouseNameEn,
    'items': [
      for (var i = 0; i < itemCount; i++)
        {
          'productId': 'p$i-$id',
          'nameAr': 'دواء $i',
          'nameEn': 'Product $i',
          'priceUsd': 25,
          'quantity': 1,
          'isAvailable': true,
        },
    ],
    'itemsTotalUsd': itemsTotalUsd,
    'totalPriceUsd': totalPriceUsd,
    'savingPercentage': savingPercentage,
  });
}
