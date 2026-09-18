import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeClient } from './realtimeClient';

// A stand-in for socket.io-client that lets a test drive connect/disconnect
// and push events, and that records how many listeners were attached - which
// is what the duplicate-listener assertions actually check.
function makeFakeSocket() {
  const listeners = new Map();
  return {
    listeners,
    connected: false,
    disconnectCalls: 0,
    removeAllCalls: 0,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    removeAllListeners() {
      this.removeAllCalls += 1;
      listeners.clear();
    },
    disconnect() {
      this.disconnectCalls += 1;
      this.connected = false;
    },
    // Test helpers.
    fire(event, payload) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
    listenerCount(event) {
      return (listeners.get(event) ?? []).length;
    },
  };
}

let sockets;
function factory() {
  const socket = makeFakeSocket();
  sockets.push(socket);
  return socket;
}

// Every emit the server makes carries its own `eventId` (see
// backend/src/realtime/index.js's emitToRoom), and that - not the entity id -
// is what dedupe keys on. `ev` stamps a fresh one; passing an explicit id is
// how a test replays the very same emit.
let eventSeq;
function ev(payload, eventId) {
  return { ...payload, eventId: eventId ?? `e-${(eventSeq += 1)}` };
}

function newClient(coalesceMs = 0) {
  return new RealtimeClient({ factory, url: 'http://test', coalesceMs });
}

beforeEach(() => {
  sockets = [];
  eventSeq = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Events are coalesced on a trailing timer, so tests advance time to flush.
function flush(ms = 1) {
  vi.advanceTimersByTime(ms);
}

describe('connection lifecycle', () => {
  it('opens exactly one connection even when connect() is called repeatedly', () => {
    const client = newClient();
    client.connect('token-1');
    client.connect('token-1');
    client.connect('token-1');

    expect(sockets).toHaveLength(1);
  });

  it('ignores connect() with no token (unauthenticated visitor)', () => {
    const client = newClient();
    client.connect(null);
    client.connect(undefined);
    client.connect('');

    expect(sockets).toHaveLength(0);
  });

  it('replaces the connection when a different account signs in', () => {
    const client = newClient();
    client.connect('token-1');
    client.connect('token-2');

    expect(sockets).toHaveLength(2);
    expect(sockets[0].disconnectCalls).toBe(1);
  });

  it('disconnect() tears down the socket and clears subscriptions', () => {
    const client = newClient();
    client.connect('token-1');
    client.on('order.created', () => {});
    client.disconnect();

    expect(sockets[0].disconnectCalls).toBe(1);
    expect(sockets[0].removeAllCalls).toBe(1);
    expect(client.isConnected).toBe(false);
  });
});

describe('subscribe-before-connect (React child-effect ordering)', () => {
  it('delivers events to a handler registered BEFORE connect()', () => {
    const client = newClient();
    const handler = vi.fn();

    // This is the real mount order: a page's useRealtimeSync effect runs
    // before the provider's connect effect, because React runs child effects
    // first. If connect() didn't wire up already-registered events, the whole
    // feature would be silently dead.
    client.on('order.created', handler);
    client.connect('token-1');

    sockets[0].fire('order.created', { orderId: 'o1' });
    flush();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('still attaches only one socket listener per event in that order', () => {
    const client = newClient();
    client.on('order.created', () => {});
    client.on('order.created', () => {});
    client.connect('token-1');

    expect(sockets[0].listenerCount('order.created')).toBe(1);
  });

  it('a provider remount (StrictMode) keeps live subscriptions working', () => {
    const client = newClient();
    const handler = vi.fn();
    client.on('order.created', handler);

    // mount -> unmount -> mount, as StrictMode does in development.
    client.connect('token-1');
    client.disconnect();
    client.connect('token-1');

    sockets[1].fire('order.created', { orderId: 'o1' });
    flush();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('duplicate listener prevention', () => {
  it('attaches ONE socket listener per event no matter how many subscribers', () => {
    const client = newClient();
    client.connect('token-1');

    client.on('order.created', () => {});
    client.on('order.created', () => {});
    client.on('order.created', () => {});

    // Four components mounting must not become four socket listeners.
    expect(sockets[0].listenerCount('order.created')).toBe(1);
  });

  it('subscribing the same function twice still only fires it once', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();

    client.on('order.created', handler);
    client.on('order.created', handler);

    sockets[0].fire('order.created', { orderId: 'o1' });
    flush();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing stops delivery (component unmount)', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();

    const unsubscribe = client.on('order.created', handler);
    unsubscribe();

    sockets[0].fire('order.created', { orderId: 'o1' });
    flush();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('duplicate event protection', () => {
  it('the same emit delivered twice results in ONE notification', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    const emitted = ev({ orderId: 'order-123' });
    sockets[0].fire('order.created', emitted);
    flush();
    // The identical emit again - a re-delivery, not a second order.
    sockets[0].fire('order.created', emitted);
    flush();

    // Order #123 must not appear twice.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('distinct orders each notify', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    sockets[0].fire('order.created', ev({ orderId: 'order-1' }));
    flush();
    sockets[0].fire('order.created', ev({ orderId: 'order-2' }));
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('successive status changes on ONE order are not treated as duplicates', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.status.updated', handler);

    sockets[0].fire('order.status.updated', ev({ orderId: 'o1', status: 'confirmed' }));
    flush();
    const preparing = ev({ orderId: 'o1', status: 'preparing' });
    sockets[0].fire('order.status.updated', preparing);
    flush();
    // ...but a replay of that same emit is still dropped.
    sockets[0].fire('order.status.updated', preparing);
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('two real changes that look identical are BOTH delivered', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('complaint.updated', handler);

    // An admin answers a complaint twice without changing its status. Keyed on
    // complaintId + status (as this used to be) the second answer vanished.
    sockets[0].fire('complaint.updated', ev({ complaintId: 'c-1', status: 'in_review' }));
    flush();
    sockets[0].fire('complaint.updated', ev({ complaintId: 'c-1', status: 'in_review' }));
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('an event with no eventId is never dropped', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    // A server older than the eventId change. Refetching is idempotent, so an
    // extra refresh is the safe side to err on.
    sockets[0].fire('order.created', { orderId: 'order-1' });
    flush();
    sockets[0].fire('order.created', { orderId: 'order-1' });
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('admin events', () => {
  it('a re-delivered account.pending is dropped, a new one is not', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('account.pending', handler);

    const first = ev({ userId: 'u-1' });
    sockets[0].fire('account.pending', first);
    flush();
    sockets[0].fire('account.pending', first);
    flush();
    sockets[0].fire('account.pending', ev({ userId: 'u-2' }));
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a re-delivered offer.pending / banner.pending is dropped too', () => {
    const client = newClient();
    client.connect('token-1');
    const offers = vi.fn();
    const banners = vi.fn();
    client.on('offer.pending', offers);
    client.on('banner.pending', banners);

    const offer = ev({ offerId: 'of-1' });
    const banner = ev({ bannerId: 'b-1' });
    sockets[0].fire('offer.pending', offer);
    flush();
    sockets[0].fire('offer.pending', offer);
    flush();
    sockets[0].fire('banner.pending', banner);
    flush();
    sockets[0].fire('banner.pending', banner);
    flush();

    expect(offers).toHaveBeenCalledTimes(1);
    expect(banners).toHaveBeenCalledTimes(1);
  });

  it('a SECOND edit to an approved offer still reaches the queue', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('offer.pending', handler);

    // Each edit of an already-approved offer parks a new pendingUpdate and
    // announces it (warehouseOffer.service.js). offer.pending carries no
    // status, so keyed on offerId alone the second edit was swallowed and the
    // admin queue never showed it.
    sockets[0].fire('offer.pending', ev({ offerId: 'of-1', warehouseId: 'w-1' }));
    flush();
    sockets[0].fire('offer.pending', ev({ offerId: 'of-1', warehouseId: 'w-1' }));
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('approving the same offer twice is two events, not one', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('offer.status.updated', handler);

    // Approve, then approve the edit that was parked on the live offer
    // (adminOffer.service.js emits 'approved' both times), and an admin edit
    // of an approved offer emits its unchanged status as well.
    sockets[0].fire('offer.status.updated', ev({ offerId: 'of-1', status: 'approved' }));
    flush();
    sockets[0].fire('offer.status.updated', ev({ offerId: 'of-1', status: 'approved' }));
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('block -> unblock -> block loses none of the three', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('account.status.updated', handler);

    sockets[0].fire('account.status.updated', ev({ userId: 'u-1', status: 'blocked' }));
    flush();
    sockets[0].fire('account.status.updated', ev({ userId: 'u-1', status: 'active' }));
    flush();
    sockets[0].fire('account.status.updated', ev({ userId: 'u-1', status: 'blocked' }));
    flush();

    // The middle unblock and the second block used to collapse into the first
    // block's key, so the Accounts page kept showing the wrong state.
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'u-1', status: 'blocked' }),
      1,
      expect.any(Array)
    );
  });

  it('pause -> make available -> pause on one package loses none of the three', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('advertisement.availability.updated', handler);

    // This payload carries isAvailable, not status, so every toggle of one
    // package used to share the single key `advertisementId` - only the very
    // first was ever delivered.
    sockets[0].fire('advertisement.availability.updated', ev({ advertisementId: 'a-1', isAvailable: false }));
    flush();
    sockets[0].fire('advertisement.availability.updated', ev({ advertisementId: 'a-1', isAvailable: true }));
    flush();
    sockets[0].fire('advertisement.availability.updated', ev({ advertisementId: 'a-1', isAvailable: false }));
    flush();

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('a re-delivered complaint.created is dropped, and a second answer at the same status is not', () => {
    const client = newClient();
    client.connect('token-1');
    const created = vi.fn();
    const updated = vi.fn();
    client.on('complaint.created', created);
    client.on('complaint.updated', updated);

    const opened = ev({ complaintId: 'c-1', status: 'pending' });
    sockets[0].fire('complaint.created', opened);
    flush();
    sockets[0].fire('complaint.created', opened);
    flush();
    expect(created).toHaveBeenCalledTimes(1);

    sockets[0].fire('complaint.updated', ev({ complaintId: 'c-1', status: 'in_review' }));
    flush();
    sockets[0].fire('complaint.updated', ev({ complaintId: 'c-1', status: 'in_review' }));
    flush();
    sockets[0].fire('complaint.updated', ev({ complaintId: 'c-1', status: 'resolved' }));
    flush();
    expect(updated).toHaveBeenCalledTimes(3);
  });

  it('an approve then reject on the same entity are both delivered', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('account.status.updated', handler);

    sockets[0].fire('account.status.updated', ev({ userId: 'u-1', status: 'active' }));
    flush();
    sockets[0].fire('account.status.updated', ev({ userId: 'u-1', status: 'blocked' }));
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('an UNRELATED event never triggers a subscriber (no wasted refetch)', () => {
    const client = newClient();
    client.connect('token-1');
    const offersPage = vi.fn();
    const accountsPage = vi.fn();
    client.on('offer.pending', offersPage);
    client.on('account.pending', accountsPage);

    // An order event, and an admin event this page didn't subscribe to.
    sockets[0].fire('order.created', ev({ orderId: 'o-1' }));
    sockets[0].fire('banner.pending', ev({ bannerId: 'b-1' }));
    sockets[0].fire('account.pending', ev({ userId: 'u-1' }));
    flush();

    expect(offersPage).not.toHaveBeenCalled();
    expect(accountsPage).toHaveBeenCalledTimes(1);
  });

  it('admin and warehouse events coalesce independently of each other', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const accounts = vi.fn();
    const offers = vi.fn();
    client.on('account.pending', accounts);
    client.on('offer.pending', offers);

    for (let i = 0; i < 5; i += 1) {
      sockets[0].fire('account.pending', { userId: `u-${i}` });
      sockets[0].fire('offer.pending', { offerId: `of-${i}` });
    }
    vi.advanceTimersByTime(400);

    // Each event name gets its own timer: one refetch per affected page, not
    // one per event and not one shared across unrelated pages.
    expect(accounts).toHaveBeenCalledTimes(1);
    expect(accounts).toHaveBeenCalledWith({ userId: 'u-4' }, 5, expect.any(Array));
    expect(offers).toHaveBeenCalledTimes(1);
    expect(offers).toHaveBeenCalledWith({ offerId: 'of-4' }, 5, expect.any(Array));
  });
});

describe('coalescing', () => {
  it('a burst of distinct events causes ONE refresh, not one per event', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    for (let i = 0; i < 20; i += 1) {
      sockets[0].fire('order.created', { orderId: `order-${i}` });
    }
    vi.advanceTimersByTime(400);

    // 20 events must not become 20 dashboard reloads.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports how many events one coalesced refresh stands for', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    sockets[0].fire('order.created', { orderId: 'o1' });
    sockets[0].fire('order.created', { orderId: 'o2' });
    sockets[0].fire('order.created', { orderId: 'o3' });
    vi.advanceTimersByTime(400);

    // Three orders arrived; the "N new orders" cue must say 3, not 1.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ orderId: 'o3' }, 3, expect.any(Array));
  });

  it('hands over every payload in the batch, oldest first', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    const first = ev({ orderId: 'o1' });
    const second = ev({ orderId: 'o2' });
    const third = ev({ orderId: 'o3' });
    sockets[0].fire('order.created', first);
    sockets[0].fire('order.created', second);
    // A re-delivery of the first emit is dropped before it joins the batch.
    sockets[0].fire('order.created', first);
    sockets[0].fire('order.created', third);
    vi.advanceTimersByTime(400);

    // The unread badges count entities, so they need all three ids - the
    // first argument alone would only ever show o3.
    expect(handler).toHaveBeenCalledWith(third, 3, [first, second, third]);
  });

  it('the count resets for the next batch', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    sockets[0].fire('order.created', { orderId: 'o1' });
    sockets[0].fire('order.created', { orderId: 'o2' });
    vi.advanceTimersByTime(400);
    sockets[0].fire('order.created', { orderId: 'o3' });
    vi.advanceTimersByTime(400);

    expect(handler).toHaveBeenNthCalledWith(1, { orderId: 'o2' }, 2, [{ orderId: 'o1' }, { orderId: 'o2' }]);
    // The payload list resets with the count - o1/o2 are not carried over.
    expect(handler).toHaveBeenNthCalledWith(2, { orderId: 'o3' }, 1, [{ orderId: 'o3' }]);
  });
});

describe('grouped coalescing (one refresh across several event names)', () => {
  it('six events across six names in one window are ONE refetch', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const load = vi.fn();
    // The admin dashboard: every card comes from the same three queues.
    client.onGroup(
      [
        'account.pending',
        'account.status.updated',
        'offer.pending',
        'offer.status.updated',
        'banner.pending',
        'banner.status.updated',
      ],
      load
    );

    sockets[0].fire('account.pending', ev({ userId: 'u-1' }));
    sockets[0].fire('account.status.updated', ev({ userId: 'u-2', status: 'active' }));
    sockets[0].fire('offer.pending', ev({ offerId: 'of-1' }));
    sockets[0].fire('offer.status.updated', ev({ offerId: 'of-2', status: 'approved' }));
    sockets[0].fire('banner.pending', ev({ bannerId: 'b-1' }));
    sockets[0].fire('banner.status.updated', ev({ bannerId: 'b-2', status: 'rejected' }));
    vi.advanceTimersByTime(400);

    // Six events, six names, one window: one load(), not six.
    expect(load).toHaveBeenCalledTimes(1);
    const [payload, count, payloads, events] = load.mock.calls[0];
    expect(count).toBe(6);
    expect(payloads).toHaveLength(6);
    expect(payload).toEqual(expect.objectContaining({ bannerId: 'b-2' }));
    expect(events).toEqual([
      'account.pending',
      'account.status.updated',
      'offer.pending',
      'offer.status.updated',
      'banner.pending',
      'banner.status.updated',
    ]);
  });

  it('per-event subscribers keep their own timers alongside a group', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const load = vi.fn();
    const accounts = vi.fn();
    const offers = vi.fn();
    client.onGroup(['account.pending', 'offer.pending'], load);
    // The badge store still subscribes per event - it needs each event's own
    // payloads, not one merged batch.
    client.on('account.pending', accounts);
    client.on('offer.pending', offers);

    sockets[0].fire('account.pending', ev({ userId: 'u-1' }));
    sockets[0].fire('offer.pending', ev({ offerId: 'of-1' }));
    vi.advanceTimersByTime(400);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][1]).toBe(2);
    expect(accounts).toHaveBeenCalledTimes(1);
    expect(accounts.mock.calls[0][1]).toBe(1);
    expect(offers).toHaveBeenCalledTimes(1);
    expect(offers.mock.calls[0][1]).toBe(1);
  });

  it('a group is only woken by its own events', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const load = vi.fn();
    client.onGroup(['complaint.created', 'complaint.updated'], load);

    sockets[0].fire('order.created', ev({ orderId: 'o-1' }));
    sockets[0].fire('account.pending', ev({ userId: 'u-1' }));
    vi.advanceTimersByTime(400);

    expect(load).not.toHaveBeenCalled();
  });

  it('the count resets for the next batch', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const load = vi.fn();
    client.onGroup(['offer.pending', 'offer.status.updated'], load);

    sockets[0].fire('offer.pending', ev({ offerId: 'of-1' }));
    sockets[0].fire('offer.status.updated', ev({ offerId: 'of-1', status: 'approved' }));
    vi.advanceTimersByTime(400);
    sockets[0].fire('offer.pending', ev({ offerId: 'of-2' }));
    vi.advanceTimersByTime(400);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[0][1]).toBe(2);
    expect(load.mock.calls[1][1]).toBe(1);
    expect(load.mock.calls[1][2]).toHaveLength(1);
  });

  it('a re-delivered emit never reaches the group either', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const load = vi.fn();
    client.onGroup(['offer.pending'], load);

    const emitted = ev({ offerId: 'of-1' });
    sockets[0].fire('offer.pending', emitted);
    sockets[0].fire('offer.pending', emitted);
    vi.advanceTimersByTime(400);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][1]).toBe(1);
  });

  it('unsubscribing a group drops a refresh that was still pending (unmount)', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    const load = vi.fn();
    const unsubscribe = client.onGroup(['offer.pending'], load);

    sockets[0].fire('offer.pending', ev({ offerId: 'of-1' }));
    unsubscribe();
    vi.advanceTimersByTime(400);

    expect(load).not.toHaveBeenCalled();
  });

  it('a group still attaches exactly one socket listener per event name', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    client.connect('token-1');
    client.onGroup(['offer.pending', 'offer.pending'], vi.fn());
    client.onGroup(['offer.pending'], vi.fn());
    client.on('offer.pending', vi.fn());

    expect(sockets[0].listenerCount('offer.pending')).toBe(1);
  });

  it('a group registered BEFORE connect() still receives events', () => {
    const client = new RealtimeClient({ factory, url: 'http://test', coalesceMs: 400 });
    const load = vi.fn();
    // Same React child-effect ordering as `on`: the page subscribes before the
    // provider connects.
    client.onGroup(['offer.pending', 'offer.status.updated'], load);
    client.connect('token-1');

    sockets[0].fire('offer.pending', ev({ offerId: 'of-1' }));
    vi.advanceTimersByTime(400);

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('reconnect resync', () => {
  it('does NOT fire the reconnect handler on the first connect', () => {
    const client = newClient();
    client.connect('token-1');
    const onReconnect = vi.fn();
    client.onReconnect(onReconnect);

    sockets[0].fire('connect');

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('fires the reconnect handler when the socket comes back after a drop', () => {
    const client = newClient();
    client.connect('token-1');
    const onReconnect = vi.fn();
    client.onReconnect(onReconnect);

    sockets[0].fire('connect');
    sockets[0].fire('disconnect');
    sockets[0].fire('connect');

    // This is what re-reads authoritative state after events may have been
    // missed while disconnected.
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('clears the dedupe memory on reconnect so a resync is never suppressed', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    const emitted = ev({ orderId: 'o1' });
    sockets[0].fire('connect');
    sockets[0].fire('order.created', emitted);
    flush();
    expect(handler).toHaveBeenCalledTimes(1);

    sockets[0].fire('disconnect');
    sockets[0].fire('connect');

    // Even the very same emit after a reconnect is worth acting on: the
    // dashboard may have missed everything in between.
    sockets[0].fire('order.created', emitted);
    flush();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('tracks connection status for the UI indicator', () => {
    const client = newClient();
    const statuses = [];
    client.onStatusChange((connected) => statuses.push(connected));
    client.connect('token-1');

    sockets[0].fire('connect');
    sockets[0].fire('disconnect');
    sockets[0].fire('connect');

    expect(statuses).toEqual([true, false, true]);
    expect(client.isConnected).toBe(true);
  });
});

describe('failure isolation', () => {
  it('a throwing subscriber does not stop the others', () => {
    const client = newClient();
    client.connect('token-1');
    const bad = vi.fn(() => {
      throw new Error('render blew up');
    });
    const good = vi.fn();
    client.on('order.created', bad);
    client.on('order.created', good);

    sockets[0].fire('order.created', { orderId: 'o1' });
    flush();

    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it('a connection error leaves the client usable and simply not connected', () => {
    const client = newClient();
    client.connect('token-1');

    sockets[0].fire('connect_error', new Error('ECONNREFUSED'));

    // Socket failure is a degraded feature, never a broken dashboard - the
    // pages keep working off HTTP regardless of this flag.
    expect(client.isConnected).toBe(false);
  });
});
