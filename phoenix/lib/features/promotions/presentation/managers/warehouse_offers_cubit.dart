import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/features/offers/data/repositories/offers_repository.dart';
import 'package:feniq/features/promotions/data/models/promotion.dart';

import 'promotions_state.dart';

/// Backs WarehouseOffersView: the offers running right now at ONE warehouse -
/// the one the pharmacist is ordering from - and nothing else.
///
/// It reads the very listing the Offers & Ads tab reads (GET /offers/active)
/// and keeps only this warehouse's rows, so every figure on screen is the
/// server-computed price the tab and the catalog already quote. No new
/// endpoint: that listing is small and already limited server-side to what a
/// pharmacy may see.
///
/// The state is the tab's own [PromotionsState] (a status, a list, an error);
/// its filters are simply never set here.
class WarehouseOffersCubit extends Cubit<PromotionsState> {
  WarehouseOffersCubit({
    required OffersRepository offersRepository,
    required String warehouseId,
  }) : _offersRepository = offersRepository,
       _warehouseId = warehouseId,
       super(const PromotionsState());

  final OffersRepository _offersRepository;

  // Fixed for the life of the screen: an offer from any other warehouse never
  // reaches the state, whatever the listing returns.
  final String _warehouseId;

  Future<void> load() async {
    emit(state.copyWith(status: PromotionsStatus.loading));
    try {
      final offers = await _offersRepository.getActiveOffers();
      // A pushed screen can be closed while the request is still out.
      if (isClosed) return;
      final promotions = <Promotion>[
        for (final offer in offers)
          if (offer.warehouseId == _warehouseId) OfferPromotion(offer),
      ]..sort(_byDeepestSaving);
      emit(state.copyWith(status: PromotionsStatus.loaded, promotions: promotions));
    } on Failure catch (f) {
      if (isClosed) return;
      emit(
        state.copyWith(
          status: PromotionsStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }

  /// The tab's own order (PromotionsCubit): deepest discount first, the key as
  /// a stable tie-break.
  static int _byDeepestSaving(Promotion a, Promotion b) {
    final bySaving = b.savingPercentage.compareTo(a.savingPercentage);
    return bySaving != 0 ? bySaving : a.key.compareTo(b.key);
  }
}
