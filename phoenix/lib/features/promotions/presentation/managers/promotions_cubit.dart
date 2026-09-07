import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/advertisements/data/models/advertisement_model.dart';
import 'package:phoenix/features/advertisements/data/repositories/advertisements_repository.dart';
import 'package:phoenix/features/offers/data/models/offer_model.dart';
import 'package:phoenix/features/offers/data/repositories/offers_repository.dart';
import 'package:phoenix/features/promotions/data/models/promotion.dart';

import 'promotions_state.dart';

/// Backs the Offers & Ads tab: the two existing "what is live right now"
/// listings, combined on the client.
///
/// There is deliberately no combined endpoint - both lists are already small,
/// already filtered server-side to what a pharmacy may see, and are fetched in
/// parallel here, so a third endpoint would only duplicate two reads that
/// already exist.
class PromotionsCubit extends Cubit<PromotionsState> {
  PromotionsCubit({
    required OffersRepository offersRepository,
    required AdvertisementsRepository advertisementsRepository,
  }) : _offersRepository = offersRepository,
       _advertisementsRepository = advertisementsRepository,
       super(const PromotionsState());

  final OffersRepository _offersRepository;
  final AdvertisementsRepository _advertisementsRepository;

  /// Fetched when the tab opens and on pull-to-refresh - the same trigger
  /// every other list in the app uses, no polling.
  Future<void> load() async {
    emit(state.copyWith(status: PromotionsStatus.loading));

    // Both started before either is awaited, so they run concurrently.
    final offersFuture = _loadOffers();
    final advertisementsFuture = _loadAdvertisements();
    final (offers, offersFailure) = await offersFuture;
    final (advertisements, advertisementsFailure) = await advertisementsFuture;

    // Only a total failure is an error: if one of the two lists came back,
    // there is still something worth browsing, and collapsing the whole tab
    // into an error message would hide it for no reason.
    if (offersFailure != null && advertisementsFailure != null) {
      emit(
        state.copyWith(
          status: PromotionsStatus.error,
          errorMessage: offersFailure.errMessage,
          errorCode: offersFailure.code,
        ),
      );
      return;
    }

    final promotions = <Promotion>[
      ...offers.map(OfferPromotion.new),
      ...advertisements.map(PackagePromotion.new),
    ]..sort(_byDeepestSaving);

    emit(
      state.copyWith(
        status: PromotionsStatus.loaded,
        promotions: promotions,
        // A filter naming a warehouse that no longer has anything running
        // would silently empty the screen, so it is dropped on reload.
        clearWarehouseFilter:
            state.warehouseFilter != null &&
            !promotions.any((p) => p.warehouseId == state.warehouseFilter),
      ),
    );
  }

  /// Deepest discount first, so the carousel's top slice is the best of what
  /// is running. Ties fall back to the key to keep the order stable across
  /// rebuilds (and predictable in tests).
  static int _byDeepestSaving(Promotion a, Promotion b) {
    final bySaving = b.savingPercentage.compareTo(a.savingPercentage);
    return bySaving != 0 ? bySaving : a.key.compareTo(b.key);
  }

  /// Null [kind] clears the type filter (both kinds shown).
  void filterByKind(PromotionKind? kind) {
    if (state.kindFilter == kind) return;
    emit(state.copyWith(kindFilter: kind, clearKindFilter: kind == null));
  }

  /// Null [warehouseId] clears the warehouse filter (all warehouses shown).
  void filterByWarehouse(String? warehouseId) {
    if (state.warehouseFilter == warehouseId) return;
    emit(
      state.copyWith(
        warehouseFilter: warehouseId,
        clearWarehouseFilter: warehouseId == null,
      ),
    );
  }

  void clearFilters() {
    if (!state.hasFilters) return;
    emit(state.copyWith(clearKindFilter: true, clearWarehouseFilter: true));
  }

  Future<(List<OfferModel>, Failure?)> _loadOffers() async {
    try {
      return (await _offersRepository.getActiveOffers(), null);
    } on Failure catch (f) {
      return (const <OfferModel>[], f);
    }
  }

  Future<(List<AdvertisementModel>, Failure?)> _loadAdvertisements() async {
    try {
      return (await _advertisementsRepository.getActiveAdvertisements(), null);
    } on Failure catch (f) {
      return (const <AdvertisementModel>[], f);
    }
  }
}
