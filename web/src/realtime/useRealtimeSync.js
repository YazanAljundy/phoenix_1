import { useEffect, useRef } from 'react';
import { useRealtime } from './RealtimeProvider';

// Subscribes a page to one or more realtime events and runs `onSync` when any
// of them fires - plus once whenever the socket reconnects, since events may
// have been missed while it was down.
//
// `onSync` is almost always the page's existing refetch (`reset()` / `load()`)
// so the authoritative state still comes from HTTP; the socket only decides
// *when* to ask.
//
// The callback is held in a ref so a page can pass an inline arrow without
// re-subscribing on every render - the effect depends only on the event names,
// which are stable. Every subscription is torn down on unmount.
//
// `grouped: true` collapses a burst spanning SEVERAL of the event names into
// one call instead of one per name (see RealtimeClient.onGroup) - what a page
// whose whole screen comes from the same queues wants, since `onSync` is then
// its single refetch. It is opt-in because the callback then sees only the
// LAST payload of the batch.
//
// The ungrouped (default) path hands the callback a 4th argument too:
// `payloads`, every payload in that event name's own coalesced batch, oldest
// first (undefined for the `reconnect` call, which has no batch). A caller
// that filters on a field (`if (payload.orderId !== orderId) return`) should
// check the WHOLE batch, not just the last payload that happens to be handed
// as the first argument - two different orders' events landing in the same
// coalescing window would otherwise let the last one's mismatch skip a
// refresh the first one's match should have triggered. See
// pages/warehouseOrderDetailRealtime.js for the extracted, testable version
// of that check.
export function useRealtimeSync(events, onSync, { grouped = false } = {}) {
  const { client } = useRealtime();
  const callbackRef = useRef(onSync);
  callbackRef.current = onSync;

  // Joined into a primitive so an inline array literal (`['a','b']`, a new
  // reference each render) doesn't retrigger the effect.
  const key = Array.isArray(events) ? events.join('|') : events;

  useEffect(() => {
    if (!client) return undefined;

    const names = key ? key.split('|') : [];
    // `count` is how many events this one callback stands for (see
    // RealtimeClient's coalescing) - relevant only to callers showing a
    // count; everyone else ignores it.
    const unsubscribes = grouped
      ? [
          client.onGroup(names, (payload, count, _payloads, batchEvents) =>
            // The event name reported is the last one in the batch, matching
            // the payload that is handed over.
            callbackRef.current?.(payload, batchEvents[batchEvents.length - 1], count)
          ),
        ]
      : names.map((event) =>
          client.on(event, (payload, count, payloads) =>
            callbackRef.current?.(payload, event, count, payloads)
          )
        );
    unsubscribes.push(client.onReconnect(() => callbackRef.current?.(null, 'reconnect', 0)));

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [client, key, grouped]);
}

// The event names the dashboards listen for. Mirrors
// backend/src/realtime/events.js.
export const REALTIME_EVENTS = {
  // Warehouse panel (room: warehouse:<id>).
  ORDER_CREATED: 'order.created',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_STATUS_UPDATED: 'order.status.updated',
  RETURN_CREATED: 'return.created',
  RETURN_STATUS_UPDATED: 'return.status.updated',
  // A pharmacy rated this warehouse.
  REVIEW_CREATED: 'review.created',

  // Admin panel (room: admin). Subscribing to account/offer/banner/
  // advertisement *pending* events from the warehouse panel would be harmless
  // but pointless - the server never puts a warehouse connection in the admin
  // room, so nothing would ever arrive.
  ACCOUNT_PENDING: 'account.pending',
  ACCOUNT_STATUS_UPDATED: 'account.status.updated',
  OFFER_PENDING: 'offer.pending',
  // The three moderation STATUS_UPDATED events also reach the warehouse panel:
  // an admin's decision, edit or delete is sent to the owning warehouse's room
  // too (never a warehouse's own change).
  OFFER_STATUS_UPDATED: 'offer.status.updated',
  BANNER_PENDING: 'banner.pending',
  BANNER_STATUS_UPDATED: 'banner.status.updated',
  ADVERTISEMENT_PENDING: 'advertisement.pending',
  ADVERTISEMENT_STATUS_UPDATED: 'advertisement.status.updated',
  // The one advertisement event that ALSO reaches the warehouse panel: the
  // server sends it to the admin room on every pause/re-enable, and to the
  // owning warehouse's room when an admin makes the change.
  ADVERTISEMENT_AVAILABILITY_UPDATED: 'advertisement.availability.updated',

  // Complaints. Routed to BOTH rooms server-side (see events.js): the admin
  // triage queue and the one warehouse a complaint is filed against.
  COMPLAINT_CREATED: 'complaint.created',
  COMPLAINT_UPDATED: 'complaint.updated',
};
