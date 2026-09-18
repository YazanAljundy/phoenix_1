import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:feniq/core/services/storage_service.dart';
import 'package:feniq/features/exchange_rate/data/repositories/exchange_rate_repository.dart';

import 'exchange_rate_state.dart';

/// SharedPreferences key holding the last successfully fetched rate.
const String kExchangeRateStorageKey = 'exchange_rate_usd_to_syp';

/// SharedPreferences key holding when that rate was fetched (epoch
/// milliseconds), so a relaunch knows how old the cached rate is instead of
/// treating it as current forever.
const String kExchangeRateFetchedAtStorageKey = 'exchange_rate_fetched_at';

/// How long a fetched rate is treated as current.
///
/// The server moves the rate on a daily 09:00 refresh plus the occasional
/// admin change, so this is not about catching a fast-moving number - it is
/// the ceiling on how wrong the SYP figures on screen can be. Ten minutes
/// keeps a browsing session to a single extra request (the rate is re-read on
/// resume, and only when it has expired), while bounding the error to one rate
/// change plus ten minutes. Same order of magnitude as AuthCubit's five-minute
/// resume-revalidation throttle, without doubling the traffic of one resume.
const Duration kExchangeRateTtl = Duration(minutes: 10);

// Registered globally (like SettingsCubit) and loaded when the app shell opens
// (WarehouseSelectionView). Every price display reads it via context.watch, so
// a refreshed rate reaches the catalog, the cart, the package cards and the
// order invoice at once.
//
// It is refreshed on two triggers, and no others: that screen opening
// (WarehouseSelectionView.load), and the app coming back to the foreground
// with an expired rate (see [kExchangeRateTtl] / [refreshIfStale]) - the
// latter called from main.dart's single app-resume observer, alongside
// AuthCubit.revalidateOnResume and NotificationCubit.refresh, rather than
// from a listener this cubit owns itself. There is no polling, and
// deliberately no fetch on checkout - the cost of a request on every submit
// is not worth the milliseconds it would shave off an already-bounded
// staleness window.
//
// Note what a stale rate does and does not cost: prices are STORED in USD and
// the cart sends USD, so a stale rate never changes what is ordered or what
// the server charges - order.service.js converts with its own current rate.
// What it changes is the SYP figure the pharmacist reads while deciding.
class ExchangeRateCubit extends Cubit<ExchangeRateState> {
  ExchangeRateCubit({
    required ExchangeRateRepository exchangeRateRepository,
    StorageService? storageService,
    // Test seam for the TTL clock; production uses the wall clock.
    DateTime Function()? now,
  }) : _exchangeRateRepository = exchangeRateRepository,
       _storageService = storageService,
       _now = now ?? DateTime.now,
       super(
         ExchangeRateState(
           usdToSyp: _readCachedRate(storageService),
           fetchedAt: _readCachedFetchedAt(storageService),
         ),
       );

  final ExchangeRateRepository _exchangeRateRepository;
  // Optional: tests build this cubit with a repository alone. Without it the
  // cubit simply doesn't remember the rate between launches.
  final StorageService? _storageService;
  final DateTime Function() _now;

  // The fetch currently in the air, so two triggers landing together (the
  // shell opening as the app resumes) make one request and share its result -
  // the same "one call at a time" rule AuthCubit.checkSession follows.
  Future<void>? _inFlight;

  // SharedPreferences is already loaded by the time main() builds this
  // (main.dart awaits getInstance()), so this read is synchronous - the last
  // known rate is in the very first state and prices render in SYP straight
  // away, before the network answers.
  static double? _readCachedRate(StorageService? storageService) {
    final raw = storageService?.getString(kExchangeRateStorageKey);
    if (raw == null) return null;
    final parsed = double.tryParse(raw);
    return (parsed == null || parsed <= 0) ? null : parsed;
  }

  static DateTime? _readCachedFetchedAt(StorageService? storageService) {
    final raw = storageService?.getString(kExchangeRateFetchedAtStorageKey);
    if (raw == null) return null;
    final millis = int.tryParse(raw);
    if (millis == null || millis <= 0) return null;
    return DateTime.fromMillisecondsSinceEpoch(millis);
  }

  /// Whether the rate on hand is old enough to be worth re-reading.
  ///
  /// A rate that has never been fetched (or whose timestamp was lost) counts
  /// as stale, so the screens showing a dash get a figure at the first
  /// opportunity. So does one stamped in the future: the device clock moved,
  /// and the age it implies means nothing.
  bool get isStale {
    final fetchedAt = state.fetchedAt;
    if (state.usdToSyp == null || fetchedAt == null) return true;
    final age = _now().difference(fetchedAt);
    return age.isNegative || age >= kExchangeRateTtl;
  }

  /// Reads the rate unconditionally. The app-shell path
  /// (WarehouseSelectionView) - "once per app session" as it always was.
  Future<void> load() => _fetch();

  /// The app-resume path: re-reads only an expired rate (see [isStale]), so a
  /// user flipping back and forth between apps costs at most one request per
  /// [kExchangeRateTtl].
  Future<void> refreshIfStale() {
    if (!isStale) return Future<void>.value();
    return _fetch();
  }

  Future<void> _fetch() {
    final inFlight = _inFlight;
    if (inFlight != null) return inFlight;
    final request = _read().whenComplete(() {
      _inFlight = null;
    });
    _inFlight = request;
    return request;
  }

  // Silent on failure by design - the rate is what converts the catalog's
  // stored USD prices into the SYP figures shown everywhere. When it can't
  // load, the cached rate from the last successful fetch keeps the prices
  // rendering; only a device that has never fetched one shows
  // currency_formatter.dart's kMoneyUnavailable dash. Either way it isn't
  // worth an error dialog.
  //
  // A failed read also leaves `fetchedAt` alone, so the rate stays stale and
  // the next resume tries again rather than waiting out another TTL.
  Future<void> _read() async {
    try {
      final rate = await _exchangeRateRepository.getExchangeRate();
      final fetchedAt = _now();
      if (isClosed) return;
      emit(state.copyWith(usdToSyp: rate.usdToSyp, fetchedAt: fetchedAt));
      await _storageService?.setString(
        kExchangeRateStorageKey,
        rate.usdToSyp.toString(),
      );
      await _storageService?.setString(
        kExchangeRateFetchedAtStorageKey,
        fetchedAt.millisecondsSinceEpoch.toString(),
      );
    } catch (_) {
      // See method comment - the cached rate stands, no error surfaced.
    }
  }
}
