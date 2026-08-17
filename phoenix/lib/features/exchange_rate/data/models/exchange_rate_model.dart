class ExchangeRateModel {
  const ExchangeRateModel({required this.usdToSyp});

  final double usdToSyp;

  factory ExchangeRateModel.fromJson(Map<String, dynamic> json) =>
      ExchangeRateModel(usdToSyp: (json['usdToSyp'] as num).toDouble());
}
