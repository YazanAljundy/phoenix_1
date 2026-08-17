class ExchangeRateState {
  const ExchangeRateState({this.usdToSyp});

  // Null until the first successful fetch (or forever, if it never
  // succeeds) - every price display treats null as "no USD hint", not an
  // error to surface (see exchange_rate_cubit.dart).
  final double? usdToSyp;

  ExchangeRateState copyWith({double? usdToSyp}) =>
      ExchangeRateState(usdToSyp: usdToSyp ?? this.usdToSyp);
}
