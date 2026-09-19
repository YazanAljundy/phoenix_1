// Writes whose USD figure the panel converted from SYP carry the rate it used
// (`rateUsed`), and the server refuses one whose rate is no longer current
// with 409 RATE_CHANGED, details { rateUsed, currentUsdToSyp } - see
// backend exchangeRate.service.js's assertRateUsedIsCurrent.

export const RATE_CHANGED = 'RATE_CHANGED';

export function isRateChangedError(err) {
  return err?.code === RATE_CHANGED;
}

// `body` plus `rateUsed` - only when something in it was actually converted.
// A value re-sent unchanged depends on no rate, and the server does not ask
// for one.
export function withRateUsed(body, rateUsed) {
  return rateUsed == null ? body : { ...body, rateUsed };
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Sends a write that may carry a converted amount - exactly ONCE.
//
// A RATE_CHANGED refusal is not retried: the amounts the user reviewed were
// worked out at the old rate. Instead the panel's rate moves to the server's
// (`actions` from useExchangeRateActions - the reported figure when the
// refusal carries one, otherwise a fresh read), and the call resolves with
// `rateChange: { from, to }` for the form to show. Saving again, at the new
// rate, is the user's to confirm.
//
// A write that carried no rate is also what leaves the panel's own figure
// unchecked, so this re-reads it once on that path - see below.
//
// Resolves to { result, rateChange }: `result` is what `send` resolved to
// (null after a refusal). Any other error is rethrown untouched.
export async function submitWithRateCheck(send, { rateUsed = null, actions = null } = {}) {
  try {
    const result = await send();
    // An accepted write that carried a rate has just had it compared against
    // the server's (assertRateUsedIsCurrent), so the panel's figure is proven
    // current and there is nothing to read.
    //
    // One that carried none was never checked against anything: nothing in it
    // was converted, so the server had no reason to look at a rate - and the
    // list this save returns to still renders its stored USD through whatever
    // rate this tab loaded at sign-in, which can be hours old (the daily
    // refresh, an admin's change). Editing a product's description therefore
    // used to leave the price column converted at yesterday's rate with no
    // way to notice. One read fixes the whole list; refresh swallows its own
    // failure, so the save stands either way.
    if (rateUsed == null) await actions?.refresh?.();
    return { result, rateChange: null };
  } catch (err) {
    if (!isRateChangedError(err)) throw err;

    let to = positiveNumber(err.details?.currentUsdToSyp);
    if (to !== null) {
      actions?.applyServerRate?.(to);
    } else {
      to = positiveNumber(await actions?.refresh?.());
    }
    const from = positiveNumber(err.details?.rateUsed) ?? positiveNumber(rateUsed);
    return { result: null, rateChange: { from, to } };
  }
}

// Moves the panel onto the rate an admin endpoint just reported.
//
// GET/PATCH /admin/exchange-rate and its /reset all answer with the rate now
// in effect (`{ exchangeRate: { usdToSyp, ... } }`), so the admin's own tab
// learns the new rate from the response it already has - no second request.
// Without this, the admin who set the rate was the one person whose panel did
// not know: the next product or package they saved still converted at the old
// one and came back refused with RATE_CHANGED.
//
// The response is the source, never what was typed: "back to automatic"
// resolves to whatever the provider returned, which is nobody's input. A
// payload with no usable rate (none has ever been set) is ignored, as is a
// missing `actions` (outside the provider).
export function applyRateFromAdminResponse(actions, data) {
  const rate = positiveNumber(data?.exchangeRate?.usdToSyp);
  if (rate === null) return null;
  actions?.applyServerRate?.(rate);
  return rate;
}

// "13,500.25 ل.س" - a rate, which unlike an amount keeps its decimals: the
// API's rate is fractional, and two rates rounding to the same whole lira
// would otherwise read as no change at all.
export function formatRate(rate, suffix) {
  const value = positiveNumber(rate);
  if (value === null) return '—';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${suffix}`;
}
