const crypto = require('crypto');
const { ApiError } = require('./ApiError');

// Shared pieces of "an idempotency key stands for one exact request".
//
// A client key alone only says "this is a retry of something". Storing a
// fingerprint of the request next to the key is what lets the server tell a
// real retry (same fingerprint - replay the stored result) from a different
// request that happens to carry the same key (refuse it, rather than hand back
// a result the caller did not ask for).

// sha256 over `${scope}:${JSON.stringify(payload)}`.
//
// `scope` names the operation AND the format version (e.g. 'payment-v1'), so
// two operations can never collide and a change to what a payload contains
// must come with a new scope - otherwise rows stored under the old format
// would start refusing their own retries.
//
// The caller normalizes `payload` first (defaults applied, text trimmed,
// lists sorted): the hash only sees what it is given. JSON.stringify keeps
// object keys in insertion order, so build the payload in a fixed order.
//
// order.service.js's computeOrderFingerprint hashes the same
// `order-v1:<json>` shape, so it can move onto this helper without changing a
// single stored fingerprint.
function requestFingerprint(scope, payload) {
  return crypto.createHash('sha256').update(`${scope}:${JSON.stringify(payload)}`).digest('hex');
}

// The one refusal for "this key already did something else". Same code and
// status for every operation, so a client has a single meaning to handle;
// `details` names the existing record when the caller is allowed to see it.
function idempotencyKeyReusedError(message, details) {
  return new ApiError(409, message, details, 'IDEMPOTENCY_KEY_REUSED');
}

module.exports = { requestFingerprint, idempotencyKeyReusedError };
