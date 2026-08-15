import 'package:logger/logger.dart';

class LoggerService {
  LoggerService({Logger? logger}) : _logger = logger ?? Logger();

  final Logger _logger;

  void info(String message) => _logger.i(message);
  void error(String message, [Object? error]) =>
      _logger.e(message, error: error);
}
