class Endpoints {
  const Endpoints._();

  static const String sendOtp = '/auth/otp/send';
  static const String register = '/auth/register';
  static const String login = '/auth/login';
  static const String loginPassword = '/auth/login-password';
  /// Exchanges a refresh token for a new access token. Unauthenticated by
  /// design - the access token it renews is expired by the time this runs.
  static const String refresh = '/auth/refresh';
  static const String me = '/auth/me';
  /// POST registers this device for push, DELETE detaches it again on
  /// logout so the next person on a shared phone does not receive the
  /// previous account's notifications.
  static const String deviceToken = '/auth/device-token';

  static const String warehouses = '/warehouses';
  static const String categories = '/categories';

  static String warehouseProducts(String warehouseId) => '/warehouses/$warehouseId/products';
  static String warehouseManufacturers(String warehouseId) => '/warehouses/$warehouseId/manufacturers';
  static String warehouseProfile(String warehouseId) => '/warehouses/$warehouseId/profile';

  static const String orders = '/orders';
  static String orderDetail(String orderId) => '/orders/$orderId';
  static String cancelOrder(String orderId) => '/orders/$orderId/cancel';
  // Optional delivery seal photo - multipart, single `image` field. Records the
  // photo on the order; does not change the order status.
  static String confirmDelivery(String orderId) => '/orders/$orderId/confirm-delivery';
  // Builds a cart payload from a past delivered order - creates no order.
  static String reorder(String orderId) => '/orders/$orderId/reorder';

  static const String returnableOrders = '/orders/returnable';
  // Account History "Money Saved" card - a read-only total, no order data.
  static const String savingsSummary = '/orders/savings-summary';

  static const String returns = '/returns';
  static String returnDetail(String returnId) => '/returns/$returnId';

  static const String complaints = '/complaints';
  static String complaintDetail(String complaintId) => '/complaints/$complaintId';

  static const String reviews = '/reviews';
  static const String exchangeRate = '/exchange-rate';

  static const String debts = '/pharmacy/debts';
  static String debtDetail(String warehouseId) => '/pharmacy/debts/$warehouseId';

  static const String activeBanners = '/banners/active';

  // Every product offer currently running, across every warehouse - the
  // Offers & Ads tab's other half. Read-only: buying a discounted product
  // still goes through the catalog and POST /orders.
  static const String activeOffers = '/offers/active';

  static const String activeAdvertisements = '/advertisements/active';
  // Builds a cart payload from an advertisement package - creates no order,
  // same as the reorder endpoint above.
  static String advertisementCart(String advertisementId) =>
      '/advertisements/$advertisementId/cart';
}
