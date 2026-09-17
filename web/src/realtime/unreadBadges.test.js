import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from './realtimeClient';
import {
  BADGE_BUCKETS,
  MAX_KEYS_PER_BUCKET,
  badgeEventsFor,
  bucketForEvent,
  countUnder,
  formatBadgeCount,
  markRead,
  parseUnread,
  recordEvent,
  serializeUnread,
  totalUnread,
  unreadStorageKey,
} from './unreadBadges';
import { WAREHOUSE_NAV } from '../utils/warehouseNav';

// The unread-badge rules, without React: what raises a tab's count, what
// clears it, and what must never touch it. UnreadBadgesProvider.jsx only wires
// these to the socket, the router and sessionStorage.

const record = (state, role, event, payloads, pathname) =>
  recordEvent(state, role, event, payloads, pathname);

// A warehouse operator sitting on Settings - a tab with no badge of its own.
const ELSEWHERE_WH = '/warehouse/settings';
const ELSEWHERE_ADM = '/admin/dashboard';

describe('what raises a badge', () => {
  it('a new order on another tab raises Orders by one', () => {
    const state = record({}, 'warehouse', 'order.created', [{ orderId: 'o1' }], ELSEWHERE_WH);
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(1);
  });

  it('an event for the tab the operator is on does not raise it', () => {
    const before = {};
    const after = record(before, 'warehouse', 'order.created', [{ orderId: 'o1' }], '/warehouse/orders');
    // Same object back - nothing changed, so React has nothing to re-render.
    expect(after).toBe(before);
  });

  it('a detail page counts as being in the tab', () => {
    const state = record({}, 'warehouse', 'order.cancelled', [{ orderId: 'o1' }], '/warehouse/orders/o9');
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(0);
  });

  it('counts every order in a coalesced batch, not just the last one', () => {
    const state = record(
      {},
      'warehouse',
      'order.created',
      [{ orderId: 'o1' }, { orderId: 'o2' }, { orderId: 'o3' }],
      ELSEWHERE_WH
    );
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(3);
  });

  it('maps each warehouse event to its own tab', () => {
    const cases = [
      ['order.created', { orderId: 'o1' }, '/warehouse/orders'],
      ['order.cancelled', { orderId: 'o2' }, '/warehouse/orders'],
      ['return.created', { returnId: 'r1', orderId: 'o1' }, '/warehouse/returns'],
      ['offer.status.updated', { offerId: 'f1', status: 'approved' }, '/warehouse/offers'],
      ['banner.status.updated', { bannerId: 'b1', status: 'rejected' }, '/warehouse/advertisements/general'],
      ['advertisement.status.updated', { advertisementId: 'a1', status: 'approved' }, '/warehouse/advertisements/packages'],
      ['advertisement.availability.updated', { advertisementId: 'a2', isAvailable: false }, '/warehouse/advertisements/packages'],
      ['review.created', { reviewId: 'v1', orderId: 'o1' }, '/warehouse/reviews'],
      ['complaint.created', { complaintId: 'c1' }, '/warehouse/complaints'],
      ['complaint.updated', { complaintId: 'c2', status: 'resolved' }, '/warehouse/complaints'],
    ];
    for (const [event, payload, path] of cases) {
      const state = record({}, 'warehouse', event, [payload], ELSEWHERE_WH);
      expect(countUnder('warehouse', state, path), event).toBe(1);
      expect(totalUnread('warehouse', state), event).toBe(1);
    }
  });

  it('maps each admin event to its own tab', () => {
    const cases = [
      ['account.pending', { userId: 'u1' }, '/admin/accounts'],
      ['account.status.updated', { userId: 'u2', status: 'active' }, '/admin/accounts'],
      ['offer.pending', { offerId: 'f1' }, '/admin/offers'],
      ['offer.status.updated', { offerId: 'f2', status: 'deleted' }, '/admin/offers'],
      ['banner.pending', { bannerId: 'b1' }, '/admin/advertisements/general'],
      ['banner.status.updated', { bannerId: 'b2', status: 'approved' }, '/admin/advertisements/general'],
      ['advertisement.pending', { advertisementId: 'a1' }, '/admin/advertisements/packages'],
      ['advertisement.status.updated', { advertisementId: 'a2', status: 'deleted' }, '/admin/advertisements/packages'],
      ['advertisement.availability.updated', { advertisementId: 'a3', isAvailable: true }, '/admin/advertisements/packages'],
      ['complaint.created', { complaintId: 'c1' }, '/admin/complaints'],
      ['complaint.updated', { complaintId: 'c2', status: 'in_review' }, '/admin/complaints'],
    ];
    for (const [event, payload, path] of cases) {
      const state = record({}, 'admin', event, [payload], ELSEWHERE_ADM);
      expect(countUnder('admin', state, path), event).toBe(1);
      expect(totalUnread('admin', state), event).toBe(1);
    }
  });

  // Both only ever come from the warehouse account itself. A return is also
  // decided from the ORDER detail page, where counting it would badge Returns
  // for the operator's own click.
  it('never counts the warehouse\'s own status changes', () => {
    for (const [event, payload] of [
      ['order.status.updated', { orderId: 'o1', status: 'confirmed' }],
      ['return.status.updated', { returnId: 'r1', orderId: 'o1', status: 'approved' }],
    ]) {
      const before = {};
      expect(record(before, 'warehouse', event, [payload], '/warehouse/orders/o1'), event).toBe(before);
      expect(record(before, 'warehouse', event, [payload], ELSEWHERE_WH), event).toBe(before);
    }
  });

  it('an event with no entity id is skipped rather than guessed at', () => {
    const before = {};
    expect(record(before, 'warehouse', 'order.created', [{}], ELSEWHERE_WH)).toBe(before);
    expect(record(before, 'warehouse', 'order.created', [null], ELSEWHERE_WH)).toBe(before);
  });
});

describe('roles stay separate', () => {
  it('an admin-only event matches no warehouse tab', () => {
    for (const event of ['account.pending', 'account.status.updated', 'offer.pending', 'banner.pending', 'advertisement.pending']) {
      expect(bucketForEvent('warehouse', event), event).toBeNull();
    }
  });

  it('a warehouse-only event matches no admin tab', () => {
    for (const event of ['order.created', 'order.cancelled', 'return.created', 'review.created']) {
      expect(bucketForEvent('admin', event), event).toBeNull();
    }
  });

  it('each role subscribes only to its own events', () => {
    expect(badgeEventsFor('warehouse')).not.toContain('account.pending');
    expect(badgeEventsFor('admin')).not.toContain('order.created');
    // Listed once each, even when two buckets could share a name.
    const events = badgeEventsFor('admin');
    expect(new Set(events).size).toBe(events.length);
  });

  it('any other role has no badges at all', () => {
    expect(badgeEventsFor('pharmacy')).toEqual([]);
    expect(badgeEventsFor(undefined)).toEqual([]);
    const before = {};
    expect(record(before, 'pharmacy', 'order.created', [{ orderId: 'o1' }], '/')).toBe(before);
  });

  it('every bucket points at a route its own panel actually has', () => {
    const warehouseTabPaths = WAREHOUSE_NAV.flatMap((item) =>
      item.children ? item.children.map((c) => c.path) : [item.path]
    );
    for (const bucket of BADGE_BUCKETS.warehouse) {
      expect(
        warehouseTabPaths.some((path) => bucket.path === path || bucket.path.startsWith(`${path}/`)),
        bucket.id
      ).toBe(true);
    }
    for (const bucket of BADGE_BUCKETS.admin) {
      expect(bucket.path.startsWith('/admin/'), bucket.id).toBe(true);
    }
  });
});

describe('no double counting', () => {
  it('the same order arriving twice counts once', () => {
    let state = record({}, 'warehouse', 'order.created', [{ orderId: 'o1' }], ELSEWHERE_WH);
    const afterFirst = state;
    state = record(state, 'warehouse', 'order.created', [{ orderId: 'o1' }], ELSEWHERE_WH);
    expect(state).toBe(afterFirst);
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(1);
  });

  it('one order created and then cancelled while away is one thing to look at', () => {
    let state = record({}, 'warehouse', 'order.created', [{ orderId: 'o1' }], ELSEWHERE_WH);
    state = record(state, 'warehouse', 'order.cancelled', [{ orderId: 'o1' }], ELSEWHERE_WH);
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(1);
  });

  it('a duplicate inside one batch counts once', () => {
    const state = record(
      {},
      'admin',
      'advertisement.status.updated',
      [
        { advertisementId: 'a1', status: 'approved' },
        { advertisementId: 'a1', status: 'approved' },
      ],
      ELSEWHERE_ADM
    );
    expect(countUnder('admin', state, '/admin/advertisements')).toBe(1);
  });

  it('the same id in two different tabs is two separate things', () => {
    let state = record({}, 'admin', 'offer.pending', [{ offerId: 'x' }], ELSEWHERE_ADM);
    state = record(state, 'admin', 'banner.pending', [{ bannerId: 'x' }], ELSEWHERE_ADM);
    expect(totalUnread('admin', state)).toBe(2);
  });

  it('stays bounded however long the tab is left unread', () => {
    let state = {};
    for (let i = 0; i < MAX_KEYS_PER_BUCKET + 50; i += 1) {
      state = record(state, 'warehouse', 'order.created', [{ orderId: `o${i}` }], ELSEWHERE_WH);
    }
    expect(state.orders).toHaveLength(MAX_KEYS_PER_BUCKET);
    // The newest are kept.
    expect(state.orders.at(-1)).toBe(`orderId:o${MAX_KEYS_PER_BUCKET + 49}`);
    expect(formatBadgeCount(countUnder('warehouse', state, '/warehouse/orders'))).toBe('99+');
  });
});

describe('opening a tab', () => {
  const seeded = () => {
    let state = {};
    state = record(state, 'warehouse', 'order.created', [{ orderId: 'o1' }, { orderId: 'o2' }], ELSEWHERE_WH);
    state = record(state, 'warehouse', 'return.created', [{ returnId: 'r1' }], ELSEWHERE_WH);
    state = record(state, 'warehouse', 'complaint.created', [{ complaintId: 'c1' }], ELSEWHERE_WH);
    return state;
  };

  it('clears that tab and only that tab', () => {
    const state = markRead(seeded(), 'warehouse', '/warehouse/orders');
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(0);
    expect(countUnder('warehouse', state, '/warehouse/returns')).toBe(1);
    expect(countUnder('warehouse', state, '/warehouse/complaints')).toBe(1);
  });

  it('Orders -> Returns -> Orders keeps each tab\'s own read state', () => {
    let state = markRead(seeded(), 'warehouse', '/warehouse/orders');
    state = markRead(state, 'warehouse', '/warehouse/returns');
    // Something new for Orders arrives while on Returns.
    state = record(state, 'warehouse', 'order.created', [{ orderId: 'o3' }], '/warehouse/returns');
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(1);
    expect(countUnder('warehouse', state, '/warehouse/returns')).toBe(0);
    state = markRead(state, 'warehouse', '/warehouse/orders');
    expect(totalUnread('warehouse', state)).toBe(1); // the complaint, untouched
  });

  it('an order read and then changed again is new again', () => {
    let state = record({}, 'warehouse', 'order.created', [{ orderId: 'o1' }], ELSEWHERE_WH);
    state = markRead(state, 'warehouse', '/warehouse/orders');
    state = record(state, 'warehouse', 'order.cancelled', [{ orderId: 'o1' }], ELSEWHERE_WH);
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(1);
  });

  it('a page with nothing unread returns the same state (no re-render)', () => {
    const state = seeded();
    expect(markRead(state, 'warehouse', '/warehouse/settings')).toBe(state);
    expect(markRead(state, 'warehouse', '/warehouse/reviews')).toBe(state);
  });

  it('General clears banners only - Packages keeps its count', () => {
    let state = record({}, 'admin', 'banner.pending', [{ bannerId: 'b1' }], ELSEWHERE_ADM);
    state = record(state, 'admin', 'advertisement.pending', [{ advertisementId: 'a1' }], ELSEWHERE_ADM);
    state = markRead(state, 'admin', '/admin/advertisements/general');
    expect(countUnder('admin', state, '/admin/advertisements/general')).toBe(0);
    expect(countUnder('admin', state, '/admin/advertisements/packages')).toBe(1);
    // The sidebar tab still shows what is left under it.
    expect(countUnder('admin', state, '/admin/advertisements')).toBe(1);
  });

  it('the Advertisements redirect URL itself clears nothing until it lands', () => {
    const state = record({}, 'admin', 'banner.pending', [{ bannerId: 'b1' }], ELSEWHERE_ADM);
    expect(markRead(state, 'admin', '/admin/advertisements')).toBe(state);
  });
});

describe('what a link shows', () => {
  const state = (() => {
    let s = {};
    s = record(s, 'warehouse', 'offer.status.updated', [{ offerId: 'f1', status: 'approved' }], ELSEWHERE_WH);
    s = record(s, 'warehouse', 'banner.status.updated', [{ bannerId: 'b1', status: 'rejected' }], ELSEWHERE_WH);
    s = record(s, 'warehouse', 'advertisement.status.updated', [{ advertisementId: 'a1', status: 'approved' }], ELSEWHERE_WH);
    s = record(s, 'warehouse', 'review.created', [{ reviewId: 'v1' }], ELSEWHERE_WH);
    return s;
  })();

  it('a pill shows only what is under its own URL', () => {
    expect(countUnder('warehouse', state, '/warehouse/offers')).toBe(1);
    expect(countUnder('warehouse', state, '/warehouse/advertisements')).toBe(2);
    expect(countUnder('warehouse', state, '/warehouse/advertisements/general')).toBe(1);
    expect(countUnder('warehouse', state, '/warehouse/discounts')).toBe(0);
  });

  it('a path merely sharing a prefix is not "under" it', () => {
    expect(countUnder('warehouse', state, '/warehouse/offer')).toBe(0);
  });

  it('a tab with no bucket shows nothing', () => {
    for (const path of ['/warehouse/products', '/warehouse/debts', '/warehouse/settings']) {
      expect(countUnder('warehouse', state, path), path).toBe(0);
    }
    for (const path of ['/admin/dashboard', '/admin/products', '/admin/catalog', '/admin/notifications']) {
      expect(countUnder('admin', {}, path), path).toBe(0);
    }
  });

  it('the total is every bucket', () => {
    expect(totalUnread('warehouse', state)).toBe(4);
    expect(totalUnread('warehouse', {})).toBe(0);
  });
});

describe('formatBadgeCount', () => {
  it('shows nothing for zero or junk', () => {
    for (const value of [0, -1, NaN, undefined, null, Infinity]) {
      expect(formatBadgeCount(value), String(value)).toBe('');
    }
  });

  it('caps at 99+', () => {
    expect(formatBadgeCount(1)).toBe('1');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
    expect(formatBadgeCount(124)).toBe('99+');
  });
});

describe('persistence', () => {
  it('round-trips a real state', () => {
    let state = record({}, 'warehouse', 'order.created', [{ orderId: 'o1' }], ELSEWHERE_WH);
    state = record(state, 'warehouse', 'review.created', [{ reviewId: 'v1' }], ELSEWHERE_WH);
    expect(parseUnread(serializeUnread(state), 'warehouse')).toEqual(state);
  });

  it('is scoped per account', () => {
    expect(unreadStorageKey('u1')).not.toBe(unreadStorageKey('u2'));
  });

  it('treats missing or corrupt storage as nothing unread', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '42', 'null', '"x"']) {
      expect(parseUnread(raw, 'warehouse'), String(raw)).toEqual({});
    }
  });

  it('drops buckets, keys and shapes this role could never have written', () => {
    const raw = JSON.stringify({
      orders: ['orderId:o1', 'orderId:o1', 42, 'returnId:r1', null],
      accounts: ['userId:u1'], // an admin bucket in a warehouse session
      returns: 'returnId:r1', // not a list
      mystery: ['x'],
    });
    expect(parseUnread(raw, 'warehouse')).toEqual({ orders: ['orderId:o1'] });
  });
});

// The provider's whole pipeline, minus React: a real RealtimeClient (with its
// own dedupe and coalescing) feeding recordEvent, the way UnreadBadgesProvider
// wires them.
describe('socket -> badge pipeline', () => {
  let socket;
  let client;
  let state;
  let pathname;

  beforeEach(() => {
    vi.useFakeTimers();
    const listeners = new Map();
    socket = {
      on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
      removeAllListeners: () => listeners.clear(),
      disconnect() {},
      fire(event, payload) {
        for (const handler of listeners.get(event) ?? []) handler(payload);
      },
    };
    client = new RealtimeClient({ factory: () => socket, url: 'http://test', coalesceMs: 400 });
    client.connect('token');
    state = {};
    pathname = '/warehouse/settings';
    for (const event of badgeEventsFor('warehouse')) {
      client.on(event, (payload, _count, payloads) => {
        state = recordEvent(state, 'warehouse', event, payloads ?? [payload], pathname);
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a burst of three new orders shows 3, once the batch lands', () => {
    socket.fire('order.created', { orderId: 'o1' });
    socket.fire('order.created', { orderId: 'o2' });
    socket.fire('order.created', { orderId: 'o3' });
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(0);
    vi.advanceTimersByTime(400);
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(3);
  });

  it('a replayed event is dropped before it can count', () => {
    socket.fire('order.created', { orderId: 'o1' });
    vi.advanceTimersByTime(400);
    socket.fire('order.created', { orderId: 'o1' });
    vi.advanceTimersByTime(400);
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(1);
  });

  it('what arrives while the operator is on the tab is not counted', () => {
    pathname = '/warehouse/returns';
    socket.fire('return.created', { returnId: 'r1', orderId: 'o1' });
    socket.fire('order.created', { orderId: 'o1' });
    vi.advanceTimersByTime(400);
    expect(countUnder('warehouse', state, '/warehouse/returns')).toBe(0);
    expect(countUnder('warehouse', state, '/warehouse/orders')).toBe(1);
  });

  it('a reconnect alone changes nothing', () => {
    socket.fire('order.created', { orderId: 'o1' });
    vi.advanceTimersByTime(400);
    const before = state;
    socket.fire('disconnect');
    socket.fire('connect');
    socket.fire('connect');
    vi.advanceTimersByTime(400);
    expect(state).toBe(before);
  });
});
