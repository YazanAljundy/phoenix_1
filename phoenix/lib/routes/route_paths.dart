class RoutePaths {
  const RoutePaths._();

  static const String splash = '/';
  static const String login = '/login';
  static const String registration = '/registration';
  static const String otp = '/otp';
  static const String approvalPending = '/approval-pending';
  static const String warehouseSelection = '/warehouse-selection';
  static const String warehouseProfile = '/warehouses/:warehouseId/profile';
  static const String manufacturers = '/manufacturers/:warehouseId';
  static const String catalog = '/catalog/:warehouseId';
  static const String cart = '/cart';
  static const String orderTracking = '/orders/:orderId';
  static const String myOrders = '/my-orders';
  static const String myReturns = '/my-returns';
  static const String profile = '/profile';
  static const String debtDetail = '/debts/:warehouseId';
}
