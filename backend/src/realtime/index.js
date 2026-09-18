const { randomUUID } = require('node:crypto');
const { Server } = require('socket.io');
const env = require('../config/env');
const { authenticateToken } = require('../middlewares/auth.middleware');
const Warehouse = require('../models/warehouse.model');
const { EVENTS, warehouseRoom, ADMIN_ROOM } = require('./events');

// The realtime layer for the React admin/warehouse dashboard.
//
// Deliberately a *notification* layer, not a data layer: HTTP stays the
// source of truth. An event says "order X in warehouse Y changed" and the
// dashboard re-reads that entity through the endpoint it already uses on
// mount. That makes a missed, duplicated, or out-of-order event harmless -
// the next fetch is authoritative either way - and means no read path here
// has to re-implement the IDOR guards the controllers already own.
//
// Nothing on the customer side uses this: the Flutter app stays on HTTP+FCM.

// Set by initRealtime(). Stays null in scripts/tests that never boot a
// server, which is exactly why every emit below goes through emitToWarehouse
// and tolerates a null io - a service must never fail because the realtime
// layer isn't running.
let io = null;

// Live sockets per user id, so blocking an account can cut its established
// connections instead of waiting for the client to reconnect (audit F-10).
// The handshake authorizes once, at connect time - nothing re-checks status on
// an already-open socket, so without this a blocked warehouse keeps receiving
// broadcasts until it happens to drop.
//
// In-memory and per-process on purpose: this is a description of *this*
// process's own open sockets, not shared state. It empties on restart, which
// is correct rather than merely tolerable - a restart drops every socket it
// describes, so the map and the connections it tracks cease to exist together.
// (A multi-instance deployment would need every instance to learn about the
// block; this project runs a single one.)
const socketsByUserId = new Map();

function trackSocket(socket) {
  const userId = socket.data.userId;
  if (!userId) return;
  let sockets = socketsByUserId.get(userId);
  if (!sockets) {
    sockets = new Set();
    socketsByUserId.set(userId, sockets);
  }
  sockets.add(socket);
}

function untrackSocket(socket) {
  const userId = socket.data.userId;
  if (!userId) return;
  const sockets = socketsByUserId.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  // Drop the empty Set rather than leaving it behind: otherwise the map gains
  // one permanent entry per user who has ever connected and never shrinks.
  if (sockets.size === 0) socketsByUserId.delete(userId);
}

function isDev() {
  return env.nodeEnv !== 'production';
}

function log(...args) {
  // Connection/room lifecycle is noisy per-user detail that's only useful
  // while developing; production keeps just the failures (logged at the call
  // sites below via console.warn/error).
  if (isDev()) {
    // eslint-disable-next-line no-console
    console.log('[realtime]', ...args);
  }
}

// Mirrors app.js's own CORS policy rather than inventing a second one: strict
// env allowlist in production, any localhost port in development (Vite's port
// shifts). Socket.IO needs its own copy because it does not run through the
// Express middleware stack.
function resolveCorsOrigin() {
  if (env.nodeEnv === 'production') {
    return env.corsOrigins.length > 0 ? env.corsOrigins : false;
  }
  return (origin, callback) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  };
}

// The handshake carries the same JWT the REST client already holds. Read from
// `auth.token` (socket.io's dedicated channel) with the Authorization header
// as a fallback for clients that set it there instead.
function extractToken(socket) {
  const fromAuth = socket.handshake.auth && socket.handshake.auth.token;
  if (typeof fromAuth === 'string' && fromAuth) {
    return fromAuth.startsWith('Bearer ') ? fromAuth.slice(7) : fromAuth;
  }
  const header = (socket.handshake.headers && socket.handshake.headers.authorization) || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Which rooms this connection is allowed in - resolved entirely server-side
// from the authenticated user's own role and profile. A client cannot ask for
// a room: there is no join handler at all (see registerConnection), so the
// only way into `warehouse:X` is to actually own warehouse X, and the only way
// into `admin` is to actually be an admin.
//
// The two branches are mutually exclusive by construction, which is what
// guarantees both directions of isolation:
//   - a warehouse user can never reach the admin room, and
//   - an admin never joins any warehouse room, so admins receive none of the
//     per-warehouse order/return traffic (they have no page for it anyway -
//     see the note in events.js).
//
// `pharmacy` falls through to [] and is refused at the handshake: the Flutter
// app stays on HTTP + FCM and has no dashboard to feed.
async function resolveRoomsFor(user) {
  if (user.role === 'admin') {
    return [ADMIN_ROOM];
  }

  if (user.role === 'warehouse') {
    const warehouse = await Warehouse.findOne({ userId: user._id }, '_id');
    if (!warehouse) return [];
    return [warehouseRoom(warehouse._id)];
  }

  return [];
}

async function handshakeAuth(socket, next) {
  try {
    const token = extractToken(socket);
    // Same verify -> load user -> reject blocked path as every HTTP request.
    const user = await authenticateToken(token);

    // Matches requireActiveStatus on the warehouse REST routes: a pending or
    // otherwise non-active account can't read this data over HTTP, so it must
    // not receive it over a socket either.
    if (user.status !== 'active') {
      log('rejected: account not active', user._id.toString());
      return next(new Error('FORBIDDEN'));
    }

    const rooms = await resolveRoomsFor(user);
    if (rooms.length === 0) {
      // Authenticated but with nothing to subscribe to (an admin, or a
      // warehouse user with no warehouse profile). Refused rather than left
      // connected holding an idle socket forever.
      log('rejected: no authorized rooms', user._id.toString(), user.role);
      return next(new Error('NO_SUBSCRIPTIONS'));
    }

    socket.data.userId = user._id.toString();
    socket.data.role = user.role;
    socket.data.rooms = rooms;
    return next();
  } catch (err) {
    log('handshake auth failed:', err.message);
    return next(new Error('UNAUTHORIZED'));
  }
}

function registerConnection(socket) {
  // Rooms are joined here, from the server-resolved list computed during the
  // handshake. There is intentionally NO socket.on('join', ...) anywhere in
  // this file - a client has no way to name a room, which is what makes
  // cross-warehouse leakage structurally impossible rather than merely
  // validated against.
  for (const room of socket.data.rooms) {
    socket.join(room);
  }
  trackSocket(socket);
  log('connected', socket.id, 'user', socket.data.userId, 'rooms', socket.data.rooms.join(','));

  socket.on('disconnect', (reason) => {
    untrackSocket(socket);
    log('disconnected', socket.id, reason);
  });
}

function initRealtime(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    cors: { origin: resolveCorsOrigin(), credentials: true },
    // Render's proxy handles websockets fine, but polling stays enabled as
    // the fallback so a restrictive corporate proxy degrades instead of
    // failing outright.
    path: '/socket.io',
  });

  io.use(handshakeAuth);
  io.on('connection', registerConnection);

  // eslint-disable-next-line no-console
  console.log('Realtime (Socket.IO) attached.');
  return io;
}

// The one place anything is ever sent. Every caller is a service that has
// ALREADY persisted its change - see the call sites - so an event never
// announces something the database didn't accept.
//
// Never throws: a realtime hiccup must not roll back or fail an HTTP request
// that already succeeded. Same defensive contract the FCM calls in these same
// services already follow.
// `eventId` identifies this one emit, and is what the dashboard dedupes on.
// It has to be per-emit rather than derived from the entity, because two real
// changes to one entity can look identical otherwise: a package paused then
// paused again after a re-enable, a second edit that re-queues an offer, an
// account blocked -> unblocked -> blocked. Keyed on the entity (or entity +
// status) the client dropped the later ones as "duplicates" and the panel
// silently kept showing the old state. See realtimeClient._isDuplicate.
//
// Two rooms receiving the same logical change (an admin decision goes to the
// admin room and to the owning warehouse's) get an id each - no client is ever
// in both rooms, and a single socket only ever needs to recognise a
// re-delivery of the very same emit.
function emitToRoom(room, event, payload) {
  try {
    if (!io || !room) return;
    io.to(room).emit(event, {
      ...payload,
      eventType: event,
      eventId: randomUUID(),
      // Debugging aid: which emit an operator is looking at in a log.
      emittedAt: new Date().toISOString(),
    });
    log('emit', event, '->', room, JSON.stringify(payload));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Realtime emit failed.', event, err.message);
  }
}

// Order/return traffic: exactly one warehouse, derived from the entity's own
// stored warehouseId. A falsy id sends to nobody rather than broadcasting.
function emitToWarehouse(warehouseId, event, payload) {
  if (!warehouseId) return;
  emitToRoom(warehouseRoom(warehouseId), event, payload);
}

// Admin-queue traffic: the shared `admin` room. Payloads stay id-only for the
// same reason the warehouse ones do - the panel re-reads the authoritative
// record through the REST endpoint it already uses.
function emitToAdmins(event, payload) {
  emitToRoom(ADMIN_ROOM, event, payload);
}

// Cuts every open socket belonging to one user, and returns how many it closed.
// Called when an account is blocked (audit F-10): every HTTP request re-reads
// status through authenticate, but a socket was authorized once at handshake
// and would otherwise keep receiving warehouse/admin broadcasts for as long as
// the client held the connection open.
//
// disconnect(true) closes the underlying transport rather than just the
// namespace, so the client cannot simply resume the session; its reconnect
// attempt goes through handshakeAuth again and is refused there on status.
//
// Never throws, for the same reason emitToRoom doesn't: an account must still
// end up blocked even if the realtime layer is unhappy or was never started.
function disconnectUser(userId) {
  try {
    if (!userId) return 0;
    const sockets = socketsByUserId.get(String(userId));
    if (!sockets || sockets.size === 0) return 0;
    // Snapshot first: disconnect() fires the 'disconnect' handler, and that
    // handler mutates this very Set through untrackSocket.
    const open = [...sockets];
    for (const socket of open) socket.disconnect(true);
    log('force-disconnected', open.length, 'socket(s) for user', String(userId));
    return open.length;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Realtime force-disconnect failed.', String(userId), err.message);
    return 0;
  }
}

// Test seam: lets the socket tests drive a real server, and resets module
// state between them. Not used by application code.
function _setIoForTesting(instance) {
  io = instance;
  // The socket registry is module state too - leaving last suite's entries
  // behind would let a stale socket object leak into the next one.
  socketsByUserId.clear();
}

module.exports = {
  initRealtime,
  emitToWarehouse,
  emitToAdmins,
  disconnectUser,
  EVENTS,
  warehouseRoom,
  ADMIN_ROOM,
  _setIoForTesting,
  _handshakeAuth: handshakeAuth,
  _registerConnection: registerConnection,
};
