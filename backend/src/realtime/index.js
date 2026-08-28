const { Server } = require('socket.io');
const env = require('../config/env');
const { authenticateToken } = require('../middlewares/auth.middleware');
const Warehouse = require('../models/warehouse.model');
const { EVENTS, warehouseRoom } = require('./events');

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

// Which warehouse rooms this connection is allowed in - resolved entirely
// server-side from the authenticated user's own profile. A client cannot ask
// for a room: there is no join handler at all (see registerConnection), so
// the only way into `warehouse:X` is to actually own warehouse X.
//
// A 'warehouse' user gets exactly the warehouse whose `userId` is theirs.
// Admins get none: no admin dashboard screen consumes these events today
// (there is no cross-warehouse order endpoint for the admin role), so
// subscribing them would leak every warehouse's activity for no feature.
async function resolveRoomsFor(user) {
  if (user.role !== 'warehouse') return [];

  const warehouse = await Warehouse.findOne({ userId: user._id }, '_id');
  if (!warehouse) return [];
  return [warehouseRoom(warehouse._id)];
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
  log('connected', socket.id, 'user', socket.data.userId, 'rooms', socket.data.rooms.join(','));

  socket.on('disconnect', (reason) => {
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

// The single emit path. Every caller is a service that has ALREADY persisted
// its change - see the call sites - so an event never announces something the
// database didn't accept.
//
// Never throws: a realtime hiccup must not roll back or fail an HTTP request
// that already succeeded. Same defensive contract the FCM calls in these same
// services already follow.
function emitToWarehouse(warehouseId, event, payload) {
  try {
    if (!io || !warehouseId) return;
    const room = warehouseRoom(warehouseId);
    io.to(room).emit(event, { ...payload, eventType: event });
    log('emit', event, '->', room, JSON.stringify(payload));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Realtime emit failed.', event, err.message);
  }
}

// Test seam: lets the socket tests drive a real server, and resets module
// state between them. Not used by application code.
function _setIoForTesting(instance) {
  io = instance;
}

module.exports = {
  initRealtime,
  emitToWarehouse,
  EVENTS,
  warehouseRoom,
  _setIoForTesting,
  _handshakeAuth: handshakeAuth,
  _registerConnection: registerConnection,
};
