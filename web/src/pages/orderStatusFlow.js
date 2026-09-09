// When advancing an order's status should stop and ask first.
//
// Kept out of the component so it can be unit-tested without a DOM (the panel
// has no jsdom/testing-library harness) - same approach as offersFilters.js
// and accountsFilters.js.
//
// Every transition used to prompt, which meant a warehouse operator clicking a
// normal order through its lifecycle answered four dialogs to do nothing
// unusual. That is friction with no signal in it: a prompt on every step is a
// prompt nobody reads. Only one step is actually worth interrupting - handing
// the order to a driver.

// The single status a warehouse operator gets asked about before leaving.
//
// preparing -> out_for_delivery is the point of no practical return: the
// shipment physically leaves the warehouse, so a mis-click here costs a phone
// call to a driver rather than one more click. Every other transition is
// cheap to get wrong and immediately visible in the status badge and the
// timeline, so they apply straight away.
//
// Note this is a *from*-status, not a pair. The panel only ever advances one
// step along a fixed forward sequence (ADVANCE_KEYS / the backend's
// PROGRESSION) with no skipping and no going back, so "leaving preparing" and
// "entering out_for_delivery" are the same event.
export const CONFIRMED_ADVANCE_FROM_STATUS = 'preparing';

// Whether advancing out of this status should show a confirmation first.
export function shouldConfirmAdvance(status) {
  return status === CONFIRMED_ADVANCE_FROM_STATUS;
}

// Decides whether an advance may proceed, asking only when it has to.
//
// `confirm` is injected rather than reaching for window.confirm here, both so
// this stays testable and so the component keeps ownership of the dialog's
// wording. It is called at most once, and never at all for the transitions
// that no longer prompt - which is the actual behaviour under test, not just
// the return value.
export function mayAdvance(status, { confirm }) {
  if (!shouldConfirmAdvance(status)) return true;
  return Boolean(confirm());
}
