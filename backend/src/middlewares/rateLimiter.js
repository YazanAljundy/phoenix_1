const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const WINDOW_MS = 15 * 60 * 1000;

// Why the general limiter is keyed on the account rather than the address.
//
// It used to be a flat 300 requests / 15 minutes / IP across every route.
// That is ~0.33 requests per second for everything arriving from one address,
// while a single catalog screen costs about 8 requests - and the pharmacies
// this serves reach the internet through mobile carriers, where a large number
// of subscribers share one public address (CGNAT). A load test from a single
// address measured 99.24% of requests rejected with 429: not a capacity limit,
// an availability cliff that only appears once real users share an egress IP.
//
// Every route below /api except /health and the four /auth POSTs already
// requires a valid JWT, so for almost all traffic the caller has a strong,
// server-verified identity that is far more meaningful than its address. The
// key is that identity when it is present, and the address only when it is
// genuinely unknowable.
//
// The token is *verified*, not merely parsed. Keying on an unverified token
// would let a client mint arbitrary bucket names and bypass the limiter
// entirely; requiring a valid signature means an attacker can only ever spend
// the quota of an account they actually hold - and accounts require admin
// approval before they can reach any of these routes (requireActiveStatus).
//
// Deliberately NOT added: a second, aggressive per-IP backstop on top of the
// per-user limit. It would reintroduce the exact CGNAT cliff this replaces.
// Abuse is already bounded by the per-account limit plus the manual approval
// gate; if a single address ever does need containment, that belongs at the
// edge/proxy, not here.
const AUTHENTICATED_LIMIT = 1000; // ~1.1 req/s sustained for one account
const ANONYMOUS_LIMIT = 300; // unchanged from before, and now only /health + /auth

// Resolved at most once per request: both keyGenerator and limit need it, and
// the order express-rate-limit calls them in is not something to depend on.
const IDENTITY = Symbol('phoenixRateLimitIdentity');

function resolveUserId(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret);
    return payload && payload.sub ? String(payload.sub) : null;
  } catch {
    // Invalid or expired: fall back to the address. The request is going to be
    // rejected by `authenticate` anyway, and it must not get a free bucket.
    return null;
  }
}

function identify(req) {
  if (!(IDENTITY in req)) {
    req[IDENTITY] = resolveUserId(req);
  }
  return req[IDENTITY];
}

const TOO_MANY_REQUESTS = { success: false, message: 'Too many requests. Please try again later.' };

// General API-wide limiter (Section 16c).
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: (req) => (identify(req) ? AUTHENTICATED_LIMIT : ANONYMOUS_LIMIT),
  keyGenerator: (req) => {
    const userId = identify(req);
    return userId ? `u:${userId}` : `ip:${req.ip}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS,
});

// Stricter limiter for /auth/* routes (login/OTP endpoints are the most
// sensitive). Deliberately left exactly as it was, still keyed by IP: these
// are the endpoints a caller reaches *without* an identity, so the address is
// the only key available, and credential stuffing is precisely what this is
// here to stop. Requests to these routes are still counted by apiLimiter too,
// against the anonymous bucket - unchanged from before.
const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS,
});

module.exports = {
  apiLimiter,
  authLimiter,
  // Exported for the rate-limiter tests, which assert the keying strategy
  // directly rather than by driving 300 requests through an app.
  _identify: identify,
  _limits: { WINDOW_MS, AUTHENTICATED_LIMIT, ANONYMOUS_LIMIT },
};
