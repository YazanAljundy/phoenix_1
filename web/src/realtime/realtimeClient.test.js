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

function newClient(coalesceMs = 0) {
  return new RealtimeClient({ factory, url: 'http://test', coalesceMs });
}

beforeEach(() => {
  sockets = [];
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
  it('the same order.created twice results in ONE notification', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    sockets[0].fire('order.created', { orderId: 'order-123' });
    flush();
    sockets[0].fire('order.created', { orderId: 'order-123' });
    flush();

    // Order #123 must not appear twice.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('distinct orders each notify', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.created', handler);

    sockets[0].fire('order.created', { orderId: 'order-1' });
    flush();
    sockets[0].fire('order.created', { orderId: 'order-2' });
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('successive status changes on ONE order are not treated as duplicates', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('order.status.updated', handler);

    sockets[0].fire('order.status.updated', { orderId: 'o1', status: 'confirmed' });
    flush();
    sockets[0].fire('order.status.updated', { orderId: 'o1', status: 'preparing' });
    flush();
    // ...but a replay of one it already saw is still dropped.
    sockets[0].fire('order.status.updated', { orderId: 'o1', status: 'preparing' });
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('admin events', () => {
  it('deduplicates by userId (account.pending)', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('account.pending', handler);

    sockets[0].fire('account.pending', { userId: 'u-1' });
    flush();
    sockets[0].fire('account.pending', { userId: 'u-1' });
    flush();
    sockets[0].fire('account.pending', { userId: 'u-2' });
    flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('deduplicates by offerId and bannerId too', () => {
    const client = newClient();
    client.connect('token-1');
    const offers = vi.fn();
    const banners = vi.fn();
    client.on('offer.pending', offers);
    client.on('banner.pending', banners);

    sockets[0].fire('offer.pending', { offerId: 'of-1' });
    flush();
    sockets[0].fire('offer.pending', { offerId: 'of-1' });
    flush();
    sockets[0].fire('banner.pending', { bannerId: 'b-1' });
    flush();
    sockets[0].fire('banner.pending', { bannerId: 'b-1' });
    flush();

    expect(offers).toHaveBeenCalledTimes(1);
    expect(banners).toHaveBeenCalledTimes(1);
  });

  it('deduplicates complaint events by complaintId, but a status change still comes through', () => {
    const client = newClient();
    client.connect('token-1');
    const created = vi.fn();
    const updated = vi.fn();
    client.on('complaint.created', created);
    client.on('complaint.updated', updated);

    sockets[0].fire('complaint.created', { complaintId: 'c-1', status: 'pending' });
    flush();
    sockets[0].fire('complaint.created', { complaintId: 'c-1', status: 'pending' });
    flush();
    expect(created).toHaveBeenCalledTimes(1);

    sockets[0].fire('complaint.updated', { complaintId: 'c-1', status: 'in_review' });
    flush();
    sockets[0].fire('complaint.updated', { complaintId: 'c-1', status: 'in_review' });
    flush();
    sockets[0].fire('complaint.updated', { complaintId: 'c-1', status: 'resolved' });
    flush();
    expect(updated).toHaveBeenCalledTimes(2);
  });

  it('an approve then reject on the same entity are both delivered', () => {
    const client = newClient();
    client.connect('token-1');
    const handler = vi.fn();
    client.on('account.status.updated', handler);

    sockets[0].fire('account.status.updated', { userId: 'u-1', status: 'active' });
    flush();
    sockets[0].fire('account.status.updated', { userId: 'u-1', status: 'blocked' });
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
    sockets[0].fire('order.created', { orderId: 'o-1' });
    sockets[0].fire('banner.pending', { bannerId: 'b-1' });
    sockets[0].fire('account.pending', { userId: 'u-1' });
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
    expect(accounts).toHaveBeenCalledWith({ userId: 'u-4' }, 5);
    expect(offers).toHaveBeenCalledTimes(1);
    expect(offers).toHaveBeenCalledWith({ offerId: 'of-4' }, 5);
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
    expect(handler).toHaveBeenCalledWith({ orderId: 'o3' }, 3);
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

    expect(handler).toHaveBeenNthCalledWith(1, { orderId: 'o2' }, 2);
    expect(handler).toHaveBeenNthCalledWith(2, { orderId: 'o3' }, 1);
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

    sockets[0].fire('connect');
    sockets[0].fire('order.created', { orderId: 'o1' });
    flush();
    expect(handler).toHaveBeenCalledTimes(1);

    sockets[0].fire('disconnect');
    sockets[0].fire('connect');

    // Same id again after a reconnect is a legitimate re-delivery, not a
    // duplicate to swallow.
    sockets[0].fire('order.created', { orderId: 'o1' });
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
