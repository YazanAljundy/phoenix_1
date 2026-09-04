import 'package:phoenix/features/advertisements/data/models/advertisement_model.dart';

enum AdvertisementsStatus { initial, loading, loaded, empty, error }

class AdvertisementsState {
  const AdvertisementsState({
    this.status = AdvertisementsStatus.initial,
    this.advertisements = const [],
    this.errorMessage,
    this.errorCode,
  });

  final AdvertisementsStatus status;
  final List<AdvertisementModel> advertisements;
  // Kept raw rather than pre-rendered: only the View has the l10n needed to
  // turn a code into the right Arabic/English sentence (see
  // core/error/error_translator.dart).
  final String? errorMessage;
  final String? errorCode;

  AdvertisementsState copyWith({
    AdvertisementsStatus? status,
    List<AdvertisementModel>? advertisements,
    String? errorMessage,
    String? errorCode,
  }) {
    return AdvertisementsState(
      status: status ?? this.status,
      advertisements: advertisements ?? this.advertisements,
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
