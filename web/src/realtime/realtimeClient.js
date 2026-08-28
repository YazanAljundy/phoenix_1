import { io } from 'socket.io-client';

// The dashboard's single Socket.IO connection, kept deliberately free of any
// React so the parts that are easy to get wrong - one connection, no leaked
// listeners, no request storm, no duplicate work - are plain testable
// functions rather than effect bodies.
//
// This layer never holds application data. An event only ever means "entity X
// changed"; every subscriber responds by re-fetching through the existing
// `api` client, which stays the source of truth. That is what makes a
// duplicated or out-of-order event a no-op instead of a bug.

const SOCKET_URL = import.meta.env?.VITE_SOCKET_URL ?? deriveSocketUrl();

// The API base is ".../api"; the socket lives at the server root. Derived from
// the one value that's already configured rather than adding a second env var
// that could drift from it.
function deriveSocketUrl() {
  const apiBase = import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
  return apiBase.replace(/\/api\/?$/, '');
}

// Events arrive in bursts (a pharmacy submits an order, the warehouse advances
// three others). Re-fetching a list per event would turn one busy minute into
// a request storm, so subscribers are notified on a trailing edge: rapid
// events collapse into a single refresh.
const COALESCE_MS = 400;

export class RealtimeClient {
  // `factory` and `now` are injection points for tests; production uses the
  // real socket.io-client and Date.now.
  constructor({ factory = io, url = SOCKET_URL, coalesceMs = COALESCE_MS } = {}) {
    this._factory = factory;
    this._url = url;
    this._coalesceMs = coalesceMs;

    this._socket = null;
    // event name -> Set of handlers. A Set is what makes a double-subscribe
    // of the same function a no-op rather than a double-fire.
    this._handlers = new Map();
    // Event names that already have their single socket-level listener.
    this._attached = new Set();
    this._reconnectHandlers = new Set();
    this._statusHandlers = new Set();
    this._timers = new Map();
    // Ids already delivered for a given event, so a replayed/duplicated event
    // never reaches a subscriber twice.
    this._seen = new Map();
    this._connected = false;
    // True once a connection has been established at least once, so the very
    // first `connect` isn't mistaken for a reconnect (which triggers resync).
    this._hasConnected = false;
  }

  get isConnected() {
    return this._connected;
  }

  // Idempotent: calling connect() again with the same token (a component
  // re-render, a provider effect re-running) keeps the existing connection
  // instead of opening a second one.
  connect(token) {
    if (!token) return;
    if (this._socket) {
      if (this._token === token) return;
      // A different account signed in - tear the old connection down first so
      // we never hold two.
      this.disconnect();
    }

    this._token = token;
    this._socket = this._factory(this._url, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    // Subscribers can (and do) register before this runs: React fires child
    // effects before parent ones, so a page's useRealtimeSync executes ahead
    // of the provider's connect(). Anything already registered gets its
    // socket-level listener attached here - without this the handlers exist
    // but nothing is ever wired to the socket, and no event is delivered.
    for (const event of this._handlers.keys()) {
      this._attachSocketListener(event);
    }

    this._socket.on('connect', () => {
      this._connected = true;
      const isReconnect = this._hasConnected;
      this._hasConnected = true;
      this._emitStatus();
      // On a reconnect the dashboard may have missed events entirely. Rather
      // than trying to replay them, subscribers re-read current state - the
      // same call they make on mount.
      if (isReconnect) {
        this._seen.clear();
        for (const handler of this._reconnectHandlers) {
          safely(handler);
        }
      }
    });

    this._socket.on('disconnect', () => {
      this._connected = false;
      this._emitStatus();
    });

    this._socket.on('connect_error', (err) => {
      this._connected = false;
      this._emitStatus();
      // Expected and non-fatal: the dashboard keeps working over HTTP. Logged
      // rather than surfaced, since there is nothing the operator can act on.
      // eslint-disable-next-line no-console
      console.warn('[realtime] connection error:', err?.message ?? err);
    });
  }

  disconnect() {
    if (this._socket) {
      this._socket.removeAllListeners();
      this._socket.disconnect();
    }
    for (const pending of this._timers.values()) clearTimeout(pending.timer);
    this._timers.clear();
    this._attached.clear();
    this._seen.clear();
    this._socket = null;
    this._token = null;
    this._connected = false;
    this._hasConnected = false;
    // _handlers/_reconnectHandlers are deliberately NOT cleared: they belong
    // to whichever components are currently mounted, which remove their own
    // via the unsubscribe returned from on(). Clearing them here would
    // silently unsubscribe live components whenever the provider remounts
    // (React StrictMode does exactly that in development).
    this._emitStatus();
  }

  // Subscribe to one event. Returns an unsubscribe function - callers (the
  // useRealtimeSync hook) return it straight from useEffect, so a component
  // unmounting can never leave a handler behind.
  on(event, handler) {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
      // Only when the socket already exists; otherwise connect() attaches it
      // (see the loop there). Either way it happens exactly once per event
      // name - four mounted components must not become four socket listeners.
      this._attachSocketListener(event);
    }
    this._handlers.get(event).add(handler);
    return () => {
      this._handlers.get(event)?.delete(handler);
    };
  }

  // One socket-level listener per event name, fanned out to subscribers by
  // _dispatch. Guarded so re-attaching is a no-op.
  _attachSocketListener(event) {
    if (!this._socket) return;
    if (this._attached.has(event)) return;
    this._attached.add(event);
    this._socket.on(event, (payload) => this._dispatch(event, payload));
  }

  // Called after the socket comes back from a drop. Same unsubscribe contract.
  onReconnect(handler) {
    this._reconnectHandlers.add(handler);
    return () => this._reconnectHandlers.delete(handler);
  }

  // Connection status, for the "live / reconnecting" indicator.
  onStatusChange(handler) {
    this._statusHandlers.add(handler);
    return () => this._statusHandlers.delete(handler);
  }

  _emitStatus() {
    for (const handler of this._statusHandlers) {
      safely(() => handler(this._connected));
    }
  }

  // Drops a repeat of an event we've already delivered. The entity id is the
  // stable key - the same order.created arriving twice is one logical event,
  // so the second is discarded rather than refreshing (or double-counting) a
  // second time.
  _isDuplicate(event, payload) {
    // One id field per entity kind across both dashboards. An event carrying
    // none of them simply isn't deduped (it still coalesces) rather than being
    // silently collapsed against unrelated events.
    const id =
      payload?.orderId ??
      payload?.returnId ??
      payload?.userId ??
      payload?.offerId ??
      payload?.bannerId;
    if (!id) return false;
    // A status change legitimately repeats for one id (pending -> confirmed
    // -> preparing), so the status is part of the key; a pure "created" never
    // repeats for the same id.
    const key = payload?.status ? `${id}:${payload.status}` : id;

    if (!this._seen.has(event)) this._seen.set(event, new Set());
    const seen = this._seen.get(event);
    if (seen.has(key)) return true;
    seen.add(key);
    // Bounded so a long-lived dashboard session can't grow this without end.
    if (seen.size > 500) {
      const oldest = seen.values().next().value;
      seen.delete(oldest);
    }
    return false;
  }

  _dispatch(event, payload) {
    if (this._isDuplicate(event, payload)) {
      // eslint-disable-next-line no-console
      console.debug('[realtime] duplicate ignored:', event, payload);
      return;
    }

    const existing = this._timers.get(event);
    if (existing) {
      clearTimeout(existing.timer);
    }
    // How many distinct events this one refresh stands for. Subscribers get
    // it as a third argument so a "3 new orders arrived" cue can stay honest
    // even though the three events collapsed into a single refetch.
    const count = (existing?.count ?? 0) + 1;

    const timer = setTimeout(() => {
      this._timers.delete(event);
      for (const handler of this._handlers.get(event) ?? []) {
        safely(() => handler(payload, count));
      }
    }, this._coalesceMs);

    this._timers.set(event, { timer, count });
  }
}

// A throwing subscriber must not take down the socket layer or stop the other
// subscribers from running.
function safely(fn) {
  try {
    fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[realtime] handler failed:', err);
  }
}

// The app-level singleton. One per tab - the provider owns its lifecycle.
export const realtimeClient = new RealtimeClient();
