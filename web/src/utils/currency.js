// Product prices are USD-denominated (Section: USD-first catalog pricing) -
// this renders the live SYP equivalent alongside it, using the session's
// cached exchange rate (see ExchangeRateContext). Null usdToSyp (rate not
// loaded yet) just omits the SYP part, no placeholder or error text.
export function formatPriceWithSyp(usdAmount, usdToSyp) {
  const usdText = `$${usdAmount}`;
  if (usdToSyp == null) return usdText;
  const syp = Math.round(usdAmount * usdToSyp).toLocaleString();
  return `${usdText} (~${syp} SYP)`;
}
