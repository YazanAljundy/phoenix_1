// Whether a coalesced realtime batch is worth refreshing this order detail
// page for.
//
// Kept out of the component so it can be unit-tested without a DOM (the panel
// has no jsdom/testing-library harness) - same approach as orderStatusFlow.js,
// offersFilters.js and accountsFilters.js.
//
// `payloads` is useRealtimeSync's 4th callback argument: every payload in this
// event name's own coalesced batch (see realtimeClient.js's `_schedule`),
// oldest first. Checking only the batch's LAST payload against this page's
// orderId - what the page used to do, since useRealtimeSync only forwarded
// the last one - could skip a refresh: order.cancelled for THIS order and
// order.status.updated for a DIFFERENT order can land in the same 400ms
// coalescing window, and the batch's last payload is whichever fired second,
// not necessarily this order's.
//
// `payloads` is undefined for exactly one case: useRealtimeSync's `reconnect`
// call, which has no batch of its own (see its `onReconnect` wiring) - that
// always counts as a match, since the socket may have missed this order's own
// events entirely while it was down.
export function realtimeBatchMatchesOrder(orderId, payloads) {
  if (!payloads) return true;
  return payloads.some((payload) => payload?.orderId === orderId);
}
