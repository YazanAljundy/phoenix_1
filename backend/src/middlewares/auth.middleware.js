const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');
const User = require('../models/user.model');

// Verifies a raw JWT and resolves the User it belongs to, applying the same
// "still allowed in" rules every authenticated HTTP request goes through.
// Throws ApiError on any failure; never returns a blocked/unknown user.
//
// Extracted from `authenticate` below (whose behavior is unchanged) so the
// Socket.IO handshake authenticates against this exact same logic instead of
// growing a second, independently-maintained auth path - see
// realtime/index.js.
async function authenticateToken(token) {
  if (!token) {
    throw ApiError.unauthorized('Authentication token is required.');
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw ApiError.unauthorized('Invalid or expired token.');
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw ApiError.unauthorized('User no longer exists.');
  }
  if (user.status === 'blocked') {
    throw ApiError.forbidden('This account has been blocked.');
  }

  return user;
}

// Verifies the JWT and attaches the current user to req.user.
// Every non-public route must use this before any handler runs (Section 16b).
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  req.user = await authenticateToken(token);
  next();
});

// Restricts a route to specific roles. Use after `authenticate`.
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw ApiError.forbidden('You do not have permission to perform this action.');
    }
    next();
  };
}

// Blocks pending accounts from routes that require admin approval first
// (Section 7). `authenticate` alone only rejects 'blocked' - 'pending' must
// stay allowed there since it's what powers the approval-pending screen's
// own status check (GET /auth/me). Use this on top for anything a pharmacist/
// warehouse shouldn't reach before being approved.
function requireActiveStatus(req, res, next) {
  if (!req.user || req.user.status !== 'active') {
    throw ApiError.forbidden('Your account is not yet approved.');
  }
  next();
}

module.exports = { authenticate, authenticateToken, authorize, requireActiveStatus };
