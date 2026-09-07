// Money-Flow V2. Shared between the two places a warehouse can record a
// payment - the Invoices tab and the order-detail modal - so the two can never
// drift from each other or from the backend.

// Mirrors payment.service.js's METHODS. Reconciliation detail only; none of
// these change a figure.
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'other'];

// SYP first: it is the default currency for every amount in the panel.
export const PAYMENT_CURRENCIES = ['SYP', 'USD'];

// A per-submission key. If the response never arrives and the operator submits
// again, the server recognises the key and returns the payment it already
// recorded instead of crediting the pharmacy twice.
//
// crypto.randomUUID exists in every browser this panel supports; the fallback
// keeps it working on an insecure origin in dev, where it is unavailable.
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
