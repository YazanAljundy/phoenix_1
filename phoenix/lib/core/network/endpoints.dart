class Endpoints {
  const Endpoints._();

  static const String sendOtp = '/auth/otp/send';
  static const String register = '/auth/register';
  static const String login = '/auth/login';
  static const String loginPassword = '/auth/login-password';
  static const String me = '/auth/me';

  static const String warehouses = '/warehouses';
  static const String categories = '/categories';

  static String warehouseProducts(String warehouseId) => '/warehouses/$warehouseId/products';

  static const String orders = '/orders';
  static String orderDetail(String orderId) => '/orders/$orderId';
  static String cancelOrder(String orderId) => '/orders/$orderId/cancel';

  static const String returns = '/returns';
  static String returnDetail(String returnId) => '/returns/$returnId';
  static const String reviews = '/reviews';
  static const String exchangeRate = '/exchange-rate';
}
