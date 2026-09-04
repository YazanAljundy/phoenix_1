import i18next from 'i18next';

// SYP (Syrian pound) is the primary display currency across the panel. The
// catalog still *stores* prices in USD (see backend product.model.js) - these
// helpers convert to the SYP figure a pharmacy is actually charged, using the
// session's cached exchange rate (see ExchangeRateContext). USD only ever
// shows as a small parenthetical hint, or as a fallback when the rate hasn't
// loaded.

// Western digits + thousands separators regardless of UI language, matching
// the Flutter app and the "100,000 ل.س" format the project owner asked for.
function group(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('en-US');
}

// The localized currency suffix - "ل.س" in Arabic, "SYP" in English. Falls
// back to "ل.س" before i18n has initialised (e.g. in unit tests).
function sypSuffix() {
  const s = i18next.isInitialized && i18next.t('common.currencySuffix');
  return s && s !== 'common.currencySuffix' ? s : 'ل.س';
}

// A whole-lira SYP amount, grouped and suffixed: 100000 -> "100,000 ل.س".
// Use for amounts that are already SYP-native (order totals, invoice lines).
export function formatSyp(sypAmount) {
  return `${group(sypAmount)} ${sypSuffix()}`;
}

// "$25.00" - the exact USD figure, for the secondary hint and the no-rate
// fallback.
export function formatUsd(usdAmount) {
  return `$${Number(usdAmount).toFixed(2)}`;
}

// Converts a USD-native amount to the SYP figure charged at order time -
// round(usd * rate), matching order.service.js. Null rate -> null.
export function sypFromUsd(usdAmount, usdToSyp) {
  if (usdToSyp == null || !Number.isFinite(Number(usdToSyp)) || Number(usdToSyp) <= 0) return null;
  return Math.round(Number(usdAmount) * Number(usdToSyp));
}

// A USD-native amount rendered as its SYP equivalent (converted at the live
// rate), or the plain USD figure as a fallback while the rate hasn't loaded.
// No parenthetical - use where space is tight (inline "saved" hints, etc.).
export function formatMoneyFromUsd(usdAmount, usdToSyp) {
  const syp = sypFromUsd(usdAmount, usdToSyp);
  return syp == null ? formatUsd(usdAmount) : `${group(syp)} ${sypSuffix()}`;
}

// Primary price text for a USD-stored product price: the SYP figure with the
// exact USD amount as a parenthetical hint once the rate is loaded, or just
// the USD figure as a fallback while it isn't. Replaces the former
// USD-primary "$25 (~125000 SYP)" rendering.
export function formatUsdAsSyp(usdAmount, usdToSyp) {
  const syp = sypFromUsd(usdAmount, usdToSyp);
  if (syp == null) return formatUsd(usdAmount);
  return `${group(syp)} ${sypSuffix()} (${formatUsd(usdAmount)})`;
}

// The "Full amount" button on the record-payment forms: the outstanding
// balance is stored in USD (pharmacyBalance.balanceUsd), so this converts it
// into whichever currency the warehouse picked for the payment. SYP is
// rounded to a whole lira; a missing rate means only the USD figure can be
// offered, so the button stays disabled for SYP in that case (callers check
// for null). A zero-or-credit balance returns null - nothing to prefill.
export function remainingPaymentAmount(balanceUsd, currency, usdToSyp) {
  const remaining = Number(balanceUsd);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  if (currency === 'USD') return Math.round(remaining * 100) / 100;
  if (currency === 'SYP') {
    const syp = sypFromUsd(remaining, usdToSyp);
    return syp;
  }
  return null;
}
