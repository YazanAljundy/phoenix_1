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
// Resolves to { result, rateChange }: `result` is what `send` resolved to
// (null after a refusal). Any other error is rethrown untouched.
export async function submitWithRateCheck(send, { rateUsed = null, actions = null } = {}) {
  try {
    return { result: await send(), rateChange: null };
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

// "13,500.25 ل.س" - a rate, which unlike an amount keeps its decimals: the
// API's rate is fractional, and two rates rounding to the same whole lira
// would otherwise read as no change at all.
export function formatRate(rate, suffix) {
  const value = positiveNumber(rate);
  if (value === null) return '—';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${suffix}`;
}
