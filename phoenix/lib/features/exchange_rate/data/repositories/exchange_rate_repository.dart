import 'package:phoenix/features/exchange_rate/data/models/exchange_rate_model.dart';

abstract class ExchangeRateRepository {
  Future<ExchangeRateModel> getExchangeRate();
}
