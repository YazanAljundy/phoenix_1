import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:feniq/core/services/storage_service.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';

import 'exchange_rate_state.dart';

/// SharedPreferences key holding the last successfully fetched rate.
const String kExchangeRateStorageKey = 'exchange_rate_usd_to_syp';

// Registered globally (like SettingsCubit) and loaded once at app startup
// (main.dart) - the rate is a single app-session-wide value, not refetched
// per screen. Every price display reads it via context.watch, so a manual
// admin update shows up the next time this cubit reloads (app restart), not
// via any polling here.
class ExchangeRateCubit extends Cubit<ExchangeRateState> {
  ExchangeRateCubit({
    required ExchangeRateRepository exchangeRateRepository,
    StorageService? storageService,
  }) : _exchangeRateRepository = exchangeRateRepository,
       _storageService = storageService,
       super(ExchangeRateState(usdToSyp: _readCached(storageService)));

  final ExchangeRateRepository _exchangeRateRepository;
  // Optional: tests build this cubit with a repository alone. Without it the
  // cubit simply doesn't remember the rate between launches.
  final StorageService? _storageService;

  // SharedPreferences is already loaded by the time main() builds this
  // (main.dart awaits getInstance()), so this read is synchronous - the last
  // known rate is in the very first state and prices render in SYP straight
  // away, before the network answers.
  static double? _readCached(StorageService? storageService) {
    final raw = storageService?.getString(kExchangeRateStorageKey);
    if (raw == null) return null;
    final parsed = double.tryParse(raw);
    return (parsed == null || parsed <= 0) ? null : parsed;
  }

  // Silent on failure by design - the rate is what converts the catalog's
  // stored USD prices into the SYP figures shown everywhere. When it can't
  // load, the cached rate from the last successful fetch keeps the prices
  // rendering; only a device that has never fetched one shows
  // currency_formatter.dart's kMoneyUnavailable dash. Either way it isn't
  // worth an error dialog.
  Future<void> load() async {
    try {
      final rate = await _exchangeRateRepository.getExchangeRate();
      emit(state.copyWith(usdToSyp: rate.usdToSyp));
      await _storageService?.setString(
        kExchangeRateStorageKey,
        rate.usdToSyp.toString(),
      );
    } catch (_) {
      // See method comment - the cached rate stands, no error surfaced.
    }
  }
}
