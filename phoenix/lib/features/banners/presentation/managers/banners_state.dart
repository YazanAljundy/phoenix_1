import 'package:phoenix/features/banners/data/models/banner_model.dart';

enum BannersStatus { initial, loading, loaded, empty, error }

class BannersState {
  const BannersState({
    this.status = BannersStatus.initial,
    this.banners = const [],
    this.errorMessage,
  });

  final BannersStatus status;
  final List<BannerModel> banners;
  final String? errorMessage;

  BannersState copyWith({
    BannersStatus? status,
    List<BannerModel>? banners,
    String? errorMessage,
  }) {
    return BannersState(
      status: status ?? this.status,
      banners: banners ?? this.banners,
      errorMessage: errorMessage,
    );
  }
}
