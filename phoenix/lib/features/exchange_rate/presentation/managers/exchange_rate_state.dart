class ExchangeRateState {
  const ExchangeRateState({this.usdToSyp});

  // Null until the first successful fetch (or forever, if it never
  // succeeds) - price displays treat null as "no rate yet" and fall back to
  // showing the raw USD amount, never an error (see exchange_rate_cubit.dart
  // and core/utils/currency_formatter.dart).
  final double? usdToSyp;

  ExchangeRateState copyWith({double? usdToSyp}) =>
      ExchangeRateState(usdToSyp: usdToSyp ?? this.usdToSyp);
}
