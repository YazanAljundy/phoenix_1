import { REALTIME_EVENTS as E } from './useRealtimeSync';
import { isUnder } from '../utils/warehouseNav';

// The "new data" badges on both panels' tabs, as plain data and pure functions.
// No React here, so all the counting rules are testable without a DOM - see
// unreadBadges.test.js. UnreadBadgesProvider.jsx just wires these to the socket,
// the router and sessionStorage.
//
// A badge means "how many things changed since you last opened this tab". It is
// NOT "does the API have new rows right now": only socket events ever raise it,
// and only opening the tab lowers it. An HTTP refetch, a re-render or a
// reconnect never touches it, and on first load it starts empty, so existing
// rows are never counted as new.
//
// A BUCKET is one source of changes tied to one URL. A nav link shows the sum of
// the buckets under its own path. That one rule covers a plain tab, a grouped
// warehouse tab (the sum of its children) and every sub-nav pill
// (/advertisements/general vs /packages), with no per-row special cases.
//
// A bucket holds the KEYS of the entities that changed, not a number. The badge
// is how many distinct entities changed, so an order that was created and then
// cancelled while you were away counts once, and a repeated event (after a
// reconnect, or a browser refresh) can never inflate it.
//
// What is counted is what another party did: a pharmacy, a warehouse, or
// another admin. Two events are deliberately left out:
// order.status.updated and return.status.updated only ever come from the
// warehouse account itself, and a return can be decided from the ORDER detail
// page, so counting it would badge Returns for the operator's own click. An
// admin always acts on an entity from that entity's own tab, so the echo of
// their own action arrives while the tab is open and is not counted either.

const ADMIN_BUCKETS = [
  {
    id: 'accounts',
    path: '/admin/accounts',
    idField: 'userId',
    events: [E.ACCOUNT_PENDING, E.ACCOUNT_STATUS_UPDATED],
  },
  {
    id: 'offers',
    path: '/admin/offers',
    idField: 'offerId',
    events: [E.OFFER_PENDING, E.OFFER_STATUS_UPDATED],
  },
  {
    id: 'banners',
    path: '/admin/advertisements/general',
    idField: 'bannerId',
    events: [E.BANNER_PENDING, E.BANNER_STATUS_UPDATED],
  },
  {
    id: 'packages',
    path: '/admin/advertisements/packages',
    idField: 'advertisementId',
    events: [
      E.ADVERTISEMENT_PENDING,
      E.ADVERTISEMENT_STATUS_UPDATED,
      E.ADVERTISEMENT_AVAILABILITY_UPDATED,
    ],
  },
  {
    id: 'complaints',
    path: '/admin/complaints',
    idField: 'complaintId',
    events: [E.COMPLAINT_CREATED, E.COMPLAINT_UPDATED],
  },
];

const WAREHOUSE_BUCKETS = [
  {
    id: 'orders',
    path: '/warehouse/orders',
    idField: 'orderId',
    events: [E.ORDER_CREATED, E.ORDER_CANCELLED],
  },
  {
    id: 'returns',
    path: '/warehouse/returns',
    idField: 'returnId',
    events: [E.RETURN_CREATED],
  },
  // The three below are an ADMIN's decision on this warehouse's own item - the
  // server sends them to the owning warehouse's room only in that case.
  {
    id: 'offers',
    path: '/warehouse/offers',
    idField: 'offerId',
    events: [E.OFFER_STATUS_UPDATED],
  },
  {
    id: 'banners',
    path: '/warehouse/advertisements/general',
    idField: 'bannerId',
    events: [E.BANNER_STATUS_UPDATED],
  },
  {
    id: 'packages',
    path: '/warehouse/advertisements/packages',
    idField: 'advertisementId',
    events: [E.ADVERTISEMENT_STATUS_UPDATED, E.ADVERTISEMENT_AVAILABILITY_UPDATED],
  },
  {
    id: 'reviews',
    path: '/warehouse/reviews',
    idField: 'reviewId',
    events: [E.REVIEW_CREATED],
  },
  {
    id: 'complaints',
    path: '/warehouse/complaints',
    idField: 'complaintId',
    events: [E.COMPLAINT_CREATED, E.COMPLAINT_UPDATED],
  },
];

export const BADGE_BUCKETS = { admin: ADMIN_BUCKETS, warehouse: WAREHOUSE_BUCKETS };

// Only the two panel roles have badges. Anything else gets none, rather than
// borrowing another role's buckets.
export function bucketsFor(role) {
  return BADGE_BUCKETS[role] ?? [];
}

// Every event name this role's badges listen to, once each.
export function badgeEventsFor(role) {
  return [...new Set(bucketsFor(role).flatMap((bucket) => bucket.events))];
}

export function bucketForEvent(role, event) {
  return bucketsFor(role).find((bucket) => bucket.events.includes(event)) ?? null;
}

// `advertisementId:abc`. Null for a payload with no id: every event the server
// sends carries one, and an event we cannot tell apart from the next is safer
// skipped than counted twice.
export function entityKey(bucket, payload) {
  const id = payload?.[bucket.idField];
  return id ? `${bucket.idField}:${id}` : null;
}

// A bucket is "open" when the current URL is its page or under it, so detail
// pages (/orders/:id, /complaints/:id) count as being in the tab.
export function isBucketActive(bucket, pathname) {
  return typeof pathname === 'string' && isUnder(pathname, bucket.path);
}

// Upper bound per bucket, oldest keys dropped first. The badge caps its label at
// 99+, so anything past that only has to stay above 99.
export const MAX_KEYS_PER_BUCKET = 200;

// Records one delivered batch of `event`. `payloads` is every payload in the
// batch (RealtimeClient hands them over). Returns the SAME state object when
// nothing changed, so React can skip the re-render.
export function recordEvent(state, role, event, payloads, pathname) {
  const bucket = bucketForEvent(role, event);
  if (!bucket) return state;
  // The operator is looking at this tab: its page refreshes itself (via
  // useRealtimeSync), so there is nothing unread to flag.
  if (isBucketActive(bucket, pathname)) return state;

  const existing = state[bucket.id] ?? [];
  const next = [...existing];
  for (const payload of payloads ?? []) {
    const key = entityKey(bucket, payload);
    if (key && !next.includes(key)) next.push(key);
  }
  if (next.length === existing.length) return state;

  return { ...state, [bucket.id]: next.slice(-MAX_KEYS_PER_BUCKET) };
}

// Opening a tab marks exactly that tab's buckets read. Every other bucket keeps
// its count.
export function markRead(state, role, pathname) {
  let next = state;
  for (const bucket of bucketsFor(role)) {
    if (isBucketActive(bucket, pathname) && (state[bucket.id]?.length ?? 0) > 0) {
      if (next === state) next = { ...state };
      delete next[bucket.id];
    }
  }
  return next;
}

// The badge for a nav link or pill pointing at `path`: every bucket under it.
export function countUnder(role, state, path) {
  let total = 0;
  for (const bucket of bucketsFor(role)) {
    if (isUnder(bucket.path, path)) total += state[bucket.id]?.length ?? 0;
  }
  return total;
}

export function totalUnread(role, state) {
  return bucketsFor(role).reduce((sum, bucket) => sum + (state[bucket.id]?.length ?? 0), 0);
}

export const BADGE_DISPLAY_MAX = 99;

// '' for nothing to show, otherwise the number, capped so a big backlog cannot
// stretch the tab.
export function formatBadgeCount(count) {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > BADGE_DISPLAY_MAX ? `${BADGE_DISPLAY_MAX}+` : String(Math.floor(count));
}

// --- persistence -------------------------------------------------------------
//
// sessionStorage, per user: the same scope as the refresh token in
// api/client.js. A browser refresh keeps the badges (the operator has not read
// anything yet). Closing the tab, signing out or switching account does not.

export function unreadStorageKey(userId) {
  return `feniq.unread.${userId}`;
}

// Anything that doesn't look exactly like a state this role could have produced
// is dropped, not trusted: storage is user-editable and survives deploys that
// rename buckets.
export function parseUnread(raw, role) {
  if (typeof raw !== 'string' || !raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const state = {};
  for (const bucket of bucketsFor(role)) {
    const keys = parsed[bucket.id];
    if (!Array.isArray(keys)) continue;
    const prefix = `${bucket.idField}:`;
    const valid = [...new Set(keys.filter((key) => typeof key === 'string' && key.startsWith(prefix)))];
    if (valid.length > 0) state[bucket.id] = valid.slice(-MAX_KEYS_PER_BUCKET);
  }
  return state;
}

export function serializeUnread(state) {
  return JSON.stringify(state);
}
