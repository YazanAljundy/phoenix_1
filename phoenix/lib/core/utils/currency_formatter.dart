import 'package:intl/intl.dart';

// The single money formatter for the whole app. SYP (Syrian pound) is the
// *only* currency shown to a user - no screen renders a USD figure any more,
// not even as a secondary hint or a fallback.
//
// The catalog still *stores* prices in USD (see ProductModel.priceUsd /
// backend product.model.js) - `formatMoneyFromUsd` converts those to the SYP
// figure the pharmacist is actually charged, using the rate from
// ExchangeRateCubit (live, or the last one it cached). Order/invoice history
// is already SYP-native (locked in at order time) - `formatSyp` just groups
// and labels those.

// Western digits + thousands separators regardless of locale, matching the
// rest of the app (which has always rendered figures with Latin digits) and
// the "100,000 ل.س" / "1,500,000 ل.س" format the project owner asked for.
final NumberFormat _grouped = NumberFormat('#,##0', 'en');

/// Placeholder for a USD-stored amount that can't be converted yet - shown
/// only when no exchange rate has *ever* loaded on this device (a first run
/// with no network; ExchangeRateCubit caches the rate after that). A neutral
/// dash rather than the raw USD figure, so the old currency never surfaces.
const String kMoneyUnavailable = '—';

/// A whole-lira SYP amount with thousands separators and the localized
/// currency suffix (`l10n.currencySuffix` - "ل.س" in Arabic, "SYP" in
/// English):
///   100000  -> "100,000 ل.س"
///   1500000 -> "1,500,000 ل.س"
String formatSyp(num sypAmount, String currencySuffix) {
  return '${_grouped.format(sypAmount.round())} $currencySuffix';
}

/// Converts a USD-native amount (the catalog's stored currency) to the SYP
/// figure the pharmacist is charged - `round(usd * rate)`, matching
/// order.service.js exactly so the catalog, the cart and the eventual
/// invoice all agree. Null rate -> null (caller shows [kMoneyUnavailable]).
num? sypFromUsd(num usdAmount, double? usdToSyp) {
  if (usdToSyp == null || usdToSyp <= 0) return null;
  return (usdAmount * usdToSyp).round();
}

/// Primary money text for a USD-native amount: SYP once a rate is available,
/// [kMoneyUnavailable] while none is (never blank, never an error, never a
/// USD figure).
String formatMoneyFromUsd(num usdAmount, double? usdToSyp, String currencySuffix) {
  final syp = sypFromUsd(usdAmount, usdToSyp);
  return syp == null ? kMoneyUnavailable : formatSyp(syp, currencySuffix);
}
