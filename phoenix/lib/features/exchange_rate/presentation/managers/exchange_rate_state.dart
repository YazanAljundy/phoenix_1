class ExchangeRateState {
  const ExchangeRateState({this.usdToSyp, this.fetchedAt});

  // Seeded from the cached rate at construction, then replaced by the first
  // successful fetch. Null only on a device that has never fetched a rate -
  // price displays treat null as "no rate yet" and show a neutral dash, never
  // a USD figure and never an error (see exchange_rate_cubit.dart and
  // core/utils/currency_formatter.dart).
  final double? usdToSyp;

  // When [usdToSyp] was read from the server, surviving a relaunch through
  // SharedPreferences. This is what makes "is the rate still current?"
  // answerable at all - see ExchangeRateCubit.isStale, which the app-resume
  // refresh is built on. Null means "never fetched on this device".
  final DateTime? fetchedAt;

  ExchangeRateState copyWith({double? usdToSyp, DateTime? fetchedAt}) =>
      ExchangeRateState(
        usdToSyp: usdToSyp ?? this.usdToSyp,
        fetchedAt: fetchedAt ?? this.fetchedAt,
      );
}
