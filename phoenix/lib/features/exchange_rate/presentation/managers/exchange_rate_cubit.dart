import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/features/exchange_rate/data/repositories/exchange_rate_repository.dart';

import 'exchange_rate_state.dart';

// Registered globally (like SettingsCubit) and loaded once at app startup
// (main.dart) - the rate is a single app-session-wide value, not refetched
// per screen. Every price display reads it via context.watch, so a manual
// admin update shows up the next time this cubit reloads (app restart), not
// via any polling here.
class ExchangeRateCubit extends Cubit<ExchangeRateState> {
  ExchangeRateCubit({required ExchangeRateRepository exchangeRateRepository})
    : _exchangeRateRepository = exchangeRateRepository,
      super(const ExchangeRateState());

  final ExchangeRateRepository _exchangeRateRepository;

  // Silent on failure by design - the rate is what converts the catalog's
  // stored USD prices into the SYP figures shown everywhere. When it can't
  // load, price displays fall back to the raw USD amount (see
  // core/utils/currency_formatter.dart's formatMoneyFromUsd); that isn't
  // worth an error dialog.
  Future<void> load() async {
    try {
      final rate = await _exchangeRateRepository.getExchangeRate();
      emit(state.copyWith(usdToSyp: rate.usdToSyp));
    } catch (_) {
      // See class comment - prices fall back to USD, no error surfaced.
    }
  }
}
