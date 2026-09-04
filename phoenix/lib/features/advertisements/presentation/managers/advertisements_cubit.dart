import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/advertisements/data/repositories/advertisements_repository.dart';

import 'advertisements_state.dart';

class AdvertisementsCubit extends Cubit<AdvertisementsState> {
  AdvertisementsCubit({required AdvertisementsRepository advertisementsRepository})
    : _advertisementsRepository = advertisementsRepository,
      super(const AdvertisementsState());

  final AdvertisementsRepository _advertisementsRepository;

  // Fetched when the warehouse-selection screen opens, the same trigger
  // BannersCubit uses - no polling or pull-to-refresh.
  Future<void> load() async {
    emit(state.copyWith(status: AdvertisementsStatus.loading));
    try {
      final advertisements = await _advertisementsRepository.getActiveAdvertisements();
      emit(
        state.copyWith(
          status: advertisements.isEmpty
              ? AdvertisementsStatus.empty
              : AdvertisementsStatus.loaded,
          advertisements: advertisements,
        ),
      );
    } on Failure catch (f) {
      // A failed advertisement fetch must never take the warehouse list down
      // with it - the section renders nothing and the rest of the screen is
      // unaffected (see AdvertisementsSection).
      emit(
        state.copyWith(
          status: AdvertisementsStatus.error,
          errorMessage: f.errMessage,
          errorCode: f.code,
        ),
      );
    }
  }
}
