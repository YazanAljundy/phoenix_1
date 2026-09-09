import 'package:feniq/features/offers/data/models/offer_model.dart';

abstract class OffersRepository {
  /// Every product offer a pharmacy may currently see, across every
  /// warehouse. The server applies the approved + date-window filter (and
  /// hides an offer whose product or warehouse has gone away), so nothing
  /// here needs to re-check status or expiry.
  Future<List<OfferModel>> getActiveOffers();
}
