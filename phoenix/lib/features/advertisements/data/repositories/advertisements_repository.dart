import 'package:phoenix/features/advertisements/data/models/advertisement_cart_preparation.dart';
import 'package:phoenix/features/advertisements/data/models/advertisement_model.dart';

abstract class AdvertisementsRepository {
  /// Every advertisement package a pharmacy may currently see. The server
  /// applies the approved + date-window filter, so nothing here needs to
  /// re-check status or expiry.
  Future<List<AdvertisementModel>> getActiveAdvertisements();

  /// Builds the cart payload for a tapped package. Creates no order.
  Future<AdvertisementCartPreparation> prepareAdvertisementCart(String advertisementId);
}
