class ExchangeRateState {
  const ExchangeRateState({this.usdToSyp});

  // Seeded from the cached rate at construction, then replaced by the first
  // successful fetch. Null only on a device that has never fetched a rate -
  // price displays treat null as "no rate yet" and show a neutral dash, never
  // a USD figure and never an error (see exchange_rate_cubit.dart and
  // core/utils/currency_formatter.dart).
  final double? usdToSyp;

  ExchangeRateState copyWith({double? usdToSyp}) =>
      ExchangeRateState(usdToSyp: usdToSyp ?? this.usdToSyp);
}
