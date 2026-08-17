// Converts a SYP amount to its approximate USD equivalent using `usdToSyp`
// (new-lira per 1 USD, from ExchangeRateCubit). Null in, null out - callers
// render SYP-only when the rate hasn't loaded, no placeholder or error text.
// Used by order/invoice history, which stays SYP-native (locked in at order
// time) - see order_invoice_section.dart.
String? formatUsdApprox(num sypAmount, double? usdToSyp) {
  if (usdToSyp == null || usdToSyp <= 0) return null;
  final usd = sypAmount / usdToSyp;
  return '~\$${usd.toStringAsFixed(1)}';
}

// The inverse: a USD amount (the catalog's native currency, see
// ProductModel.priceUsd) to its approximate SYP equivalent. Used by the
// catalog and cart, where USD is primary and this is the secondary hint.
String? formatSypApprox(num usdAmount, double? usdToSyp, String currencySuffix) {
  if (usdToSyp == null || usdToSyp <= 0) return null;
  final syp = usdAmount * usdToSyp;
  return '~${syp.toStringAsFixed(0)} $currencySuffix';
}
