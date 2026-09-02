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
export function useRealtimeSync(events, onSync) {
  const { client } = useRealtime();
  const callbackRef = useRef(onSync);
  callbackRef.current = onSync;

  // Joined into a primitive so an inline array literal (`['a','b']`, a new
  // reference each render) doesn't retrigger the effect.
  const key = Array.isArray(events) ? events.join('|') : events;

  useEffect(() => {
    if (!client) return undefined;

    const names = key ? key.split('|') : [];
    const unsubscribes = names.map((event) =>
      // `count` is how many events this one callback stands for (see
      // RealtimeClient's coalescing) - relevant only to callers showing a
      // count; everyone else ignores it.
      client.on(event, (payload, count) => callbackRef.current?.(payload, event, count))
    );
    unsubscribes.push(client.onReconnect(() => callbackRef.current?.(null, 'reconnect', 0)));

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [client, key]);
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

  // Admin panel (room: admin). Subscribing to one of these from the warehouse
  // panel would be harmless but pointless - the server never puts a warehouse
  // connection in the admin room, so nothing would ever arrive.
  ACCOUNT_PENDING: 'account.pending',
  ACCOUNT_STATUS_UPDATED: 'account.status.updated',
  OFFER_PENDING: 'offer.pending',
  OFFER_STATUS_UPDATED: 'offer.status.updated',
  BANNER_PENDING: 'banner.pending',
  BANNER_STATUS_UPDATED: 'banner.status.updated',

  // Complaints. Routed to BOTH rooms server-side (see events.js): the admin
  // triage queue and the one warehouse a complaint is filed against.
  COMPLAINT_CREATED: 'complaint.created',
  COMPLAINT_UPDATED: 'complaint.updated',
};
