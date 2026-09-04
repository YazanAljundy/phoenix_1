import 'package:intl/intl.dart';

// The single money formatter for the whole app. SYP (Syrian pound) is the
// primary display currency everywhere a monetary amount is shown to a user;
// USD only ever appears as a small secondary hint next to it, or as a
// fallback when the exchange rate hasn't loaded.
//
// The catalog still *stores* prices in USD (see ProductModel.priceUsd /
// backend product.model.js) - `formatMoneyFromUsd` converts those to the SYP
// figure the pharmacist is actually charged, using the live rate from
// ExchangeRateCubit. Order/invoice history is already SYP-native (locked in
// at order time) - `formatSyp` just groups and labels those.

// Western digits + thousands separators regardless of locale, matching the
// rest of the app (which has always rendered figures with Latin digits) and
// the "100,000 ل.س" / "1,500,000 ل.س" format the project owner asked for.
final NumberFormat _grouped = NumberFormat('#,##0', 'en');

/// A whole-lira SYP amount with thousands separators and the localized
/// currency suffix (`l10n.currencySuffix` - "ل.س" in Arabic, "SYP" in
/// English):
///   100000  -> "100,000 ل.س"
///   1500000 -> "1,500,000 ل.س"
String formatSyp(num sypAmount, String currencySuffix) {
  return '${_grouped.format(sypAmount.round())} $currencySuffix';
}

/// "$25.00" - the exact USD figure. Used as the secondary hint beside a
/// SYP-primary price and as the fallback when no exchange rate is loaded.
String formatUsd(num usdAmount) => '\$${usdAmount.toStringAsFixed(2)}';

/// Converts a USD-native amount (the catalog's stored currency) to the SYP
/// figure the pharmacist is charged - `round(usd * rate)`, matching
/// order.service.js exactly so the catalog, the cart and the eventual
/// invoice all agree. Null rate -> null (caller shows USD instead).
num? sypFromUsd(num usdAmount, double? usdToSyp) {
  if (usdToSyp == null || usdToSyp <= 0) return null;
  return (usdAmount * usdToSyp).round();
}

/// Primary money text for a USD-native amount: SYP once the rate is loaded,
/// the plain USD figure as a fallback while it isn't (never blank, never an
/// error).
String formatMoneyFromUsd(num usdAmount, double? usdToSyp, String currencySuffix) {
  final syp = sypFromUsd(usdAmount, usdToSyp);
  return syp == null ? formatUsd(usdAmount) : formatSyp(syp, currencySuffix);
}

/// Secondary "~ $25.00" hint shown beside a SYP-primary price whose source
/// amount is USD-native (catalog / cart / debts). Null when there's no rate -
/// the primary text is already the USD figure in that case, so there's
/// nothing to contrast it with.
String? usdHintFromUsd(num usdAmount, double? usdToSyp) {
  if (usdToSyp == null || usdToSyp <= 0) return null;
  return '~${formatUsd(usdAmount)}';
}

/// Secondary "~ $3.00" hint for a SYP-native amount (order/invoice history,
/// locked in at order time). Null in, null out - callers render SYP-only
/// when the rate hasn't loaded. See order_invoice_section.dart.
String? formatUsdApprox(num sypAmount, double? usdToSyp) {
  if (usdToSyp == null || usdToSyp <= 0) return null;
  return '~\$${(sypAmount / usdToSyp).toStringAsFixed(2)}';
}
