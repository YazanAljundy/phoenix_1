const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { normalizePhone } = require('../utils/phone');

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
const IDENTITY = Symbol('feniqRateLimitIdentity');

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

// An explicit, test-only opt-out for the credential limiters.
//
// The limiters below are keyed by address and by phone number, and an
// automated suite is one address driving a handful of numbers - so a suite
// that exercises the auth FLOW (auth.security.test.js: lockouts, OTP
// ceilings, recovery) trips them on the harness itself and cannot make more
// than 20 requests at all.
//
// Deliberately an explicit flag rather than a blanket `NODE_ENV === 'test'`
// skip: ratelimit.test.js asserts the limiters by genuinely driving requests
// through them, and a blanket skip would silently turn those regression tests
// into no-ops that pass for the wrong reason. Only a suite that opts in loses
// the limiter, and it says so at the top of its own file.
//
// Guarded on NODE_ENV as well, so setting the variable in a real deployment
// cannot disable anything.
const limitersDisabled = () =>
  env.nodeEnv === 'test' && process.env.DISABLE_AUTH_RATE_LIMIT === '1';

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
  skip: limitersDisabled,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS,
});

// Per-PHONE limiter for the credential endpoints (Audit H-2).
//
// authLimiter above is keyed by address, and that is the half of the problem
// it can actually solve. It does nothing about the other half: an attacker
// spread across 50 addresses gets 50 x 20 attempts per window against a single
// account, and the pharmacies this serves sit behind carrier CGNAT where one
// address is shared by many legitimate users anyway. Keying on the phone
// number in the body bounds what any number of addresses can do to one
// account.
//
// Deliberately ADDITIVE - authLimiter stays exactly as it was. The two answer
// different questions ("is this address abusive?" vs "is this account under
// attack?") and neither subsumes the other.
//
// skipSuccessfulRequests: a pharmacist who signs in correctly ten times in an
// hour (app reinstall, several devices) must never be throttled. Only failures
// count, which is also what makes the hour-long window safe to set this low.
const PHONE_WINDOW_MS = 60 * 60 * 1000;
const PHONE_LIMIT = 10;

// Falls back to the address when the body carries no usable phone: such a
// request is going to be rejected as a bad request anyway, and it must not get
// an unlimited free bucket by simply omitting the field.
function phoneKey(req) {
  const phone = normalizePhone(req.body && req.body.phone);
  return phone ? `ph:${phone}` : `ip:${req.ip}`;
}

const phoneAuthLimiter = rateLimit({
  windowMs: PHONE_WINDOW_MS,
  limit: PHONE_LIMIT,
  keyGenerator: phoneKey,
  skip: limitersDisabled,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS,
});

// POST /auth/refresh gets its own, far more generous per-IP bucket rather
// than sharing authLimiter's 20.
//
// Access tokens live 24h, so a pharmacy that opened the app at 9am yesterday
// refreshes at about 9am today - and behind a carrier NAT that is dozens of
// pharmacies refreshing inside the same quarter-hour from one address. At 20
// per 15 minutes that morning stampede would rediscover the exact CGNAT
// availability cliff documented at the top of this file, except this time it
// would log people out rather than just slow them down.
//
// Still IP-keyed and still bounded: a refresh presents no verifiable JWT
// identity (that is the point of it), so the address is the only key
// available, exactly as for authLimiter.
const refreshLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS,
});

module.exports = {
  apiLimiter,
  authLimiter,
  refreshLimiter,
  phoneAuthLimiter,
  // Exported for the rate-limiter tests, which assert the keying strategy
  // directly rather than by driving 300 requests through an app.
  _identify: identify,
  _phoneKey: phoneKey,
  _limits: { WINDOW_MS, AUTHENTICATED_LIMIT, ANONYMOUS_LIMIT, PHONE_WINDOW_MS, PHONE_LIMIT },
};
