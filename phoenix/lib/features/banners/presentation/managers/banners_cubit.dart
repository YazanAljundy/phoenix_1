import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/features/banners/data/repositories/banners_repository.dart';

import 'banners_state.dart';

class BannersCubit extends Cubit<BannersState> {
  BannersCubit({required BannersRepository bannersRepository})
    : _bannersRepository = bannersRepository,
      super(const BannersState());

  final BannersRepository _bannersRepository;

  // Fetched once when the warehouse-selection screen opens - no pull-to-
  // refresh or polling, per the request.
  Future<void> load() async {
    emit(state.copyWith(status: BannersStatus.loading));
    try {
      final banners = await _bannersRepository.getActiveBanners();
      emit(
        state.copyWith(
          status: banners.isEmpty ? BannersStatus.empty : BannersStatus.loaded,
          banners: banners,
        ),
      );
    } on Failure catch (f) {
      emit(state.copyWith(status: BannersStatus.error, errorMessage: f.errMessage));
    }
  }
}
