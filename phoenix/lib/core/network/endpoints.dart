class Endpoints {
  const Endpoints._();

  static const String sendOtp = '/auth/otp/send';
  static const String register = '/auth/register';
  static const String login = '/auth/login';
  static const String loginPassword = '/auth/login-password';
  static const String me = '/auth/me';
  static const String deviceToken = '/auth/device-token';

  static const String warehouses = '/warehouses';
  static const String categories = '/categories';

  static String warehouseProducts(String warehouseId) => '/warehouses/$warehouseId/products';
  static String warehouseManufacturers(String warehouseId) => '/warehouses/$warehouseId/manufacturers';
  static String warehouseProfile(String warehouseId) => '/warehouses/$warehouseId/profile';

  static const String orders = '/orders';
  static String orderDetail(String orderId) => '/orders/$orderId';
  static String cancelOrder(String orderId) => '/orders/$orderId/cancel';
  // Builds a cart payload from a past delivered order - creates no order.
  static String reorder(String orderId) => '/orders/$orderId/reorder';

  static const String returnableOrders = '/orders/returnable';

  static const String returns = '/returns';
  static String returnDetail(String returnId) => '/returns/$returnId';

  static const String complaints = '/complaints';
  static String complaintDetail(String complaintId) => '/complaints/$complaintId';

  static const String reviews = '/reviews';
  static const String exchangeRate = '/exchange-rate';

  static const String debts = '/pharmacy/debts';
  static String debtDetail(String warehouseId) => '/pharmacy/debts/$warehouseId';

  static const String activeBanners = '/banners/active';
}
