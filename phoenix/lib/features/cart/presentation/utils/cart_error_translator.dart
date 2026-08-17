import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/generated/app_localizations.dart';

// Renders order.service.js's STOCK_CHECK_FAILED `details.problems` into a
// localized, human-readable sentence. The server only sends { code,
// productId } - no product name - because the client already knows every
// cart item's localized name (it's the one that put them there); this just
// looks it up locally instead of round-tripping it.
String describeStockProblems(
  AppLocalizations l10n,
  bool isArabic,
  List<Map<String, dynamic>> problems,
  List<CartItem> cartItems,
) {
  final lines = problems.map((problem) {
    final productId = problem['productId'] as String?;
    final item = _findItem(cartItems, productId);
    final name = item != null
        ? (isArabic ? item.nameAr : item.nameEn)
        : l10n.thisItemFallback;

    switch (problem['code']) {
      case 'PRODUCT_UNAVAILABLE':
        return l10n.errorProductUnavailable(name);
      case 'PRODUCT_NOT_FOUND':
      default:
        return l10n.errorProductNotFound(name);
    }
  });

  return lines.join(' ');
}

CartItem? _findItem(List<CartItem> items, String? productId) {
  for (final item in items) {
    if (item.productId == productId) return item;
  }
  return null;
}
