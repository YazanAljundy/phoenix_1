import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/generated/app_localizations.dart';

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
        ? (isArabic ? item.nameAr : (item.nameEn ?? item.nameAr))
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

// Renders order.service.js's PRICE_CHANGED `details.problems`. Same contract
// as describeStockProblems above - the server sends ids and numbers, the
// client supplies the localized name it already has. `formatMoney` is passed
// in rather than imported so this file stays free of BuildContext: the two
// prices arrive USD-denominated (the catalog's native currency) and the
// caller converts them at the live rate, exactly as the order-limit
// rejections do.
String describePriceProblems(
  AppLocalizations l10n,
  bool isArabic,
  List<Map<String, dynamic>> problems,
  List<CartItem> cartItems,
  String Function(num) formatMoney,
) {
  final lines = problems.map((problem) {
    final productId = problem['productId'] as String?;
    final item = _findItem(cartItems, productId);
    final name = item != null
        ? (isArabic ? item.nameAr : (item.nameEn ?? item.nameAr))
        : l10n.thisItemFallback;

    final newPrice = problem['currentPriceUsd'];
    final oldPrice = problem['displayedPriceUsd'];
    if (newPrice is! num || oldPrice is! num) {
      return l10n.errorPriceChangedGeneric;
    }

    return l10n.errorPriceChanged(name, formatMoney(newPrice), formatMoney(oldPrice));
  });

  // The hint matters more than the list here: unlike an unavailable item,
  // nothing needs removing - resubmitting is what accepts the new price.
  return '${lines.join(' ')} ${l10n.priceChangedConfirmHint}';
}

// Renders a PACKAGE_UNAVAILABLE refusal. By the time it is shown, CartCubit has
// already flagged the refused package lines (isAvailable: false) from the
// server's `details.advertisementIds`, so the names are read off those lines -
// the same "the client already knows the names" contract as the two above.
String describeUnavailablePackages(
  AppLocalizations l10n,
  bool isArabic,
  List<CartItem> cartItems,
) {
  final names = cartItems
      .where((item) => item.isPackage && !item.isAvailable)
      .map((item) => isArabic ? item.nameAr : (item.nameEn ?? item.nameAr))
      .join(isArabic ? '، ' : ', ');
  if (names.isEmpty) return l10n.errorPackageUnavailable;
  return l10n.packageUnavailableCheckoutMessage(names);
}

CartItem? _findItem(List<CartItem> items, String? productId) {
  for (final item in items) {
    if (item.productId == productId) return item;
  }
  return null;
}
