// Single source of truth for the password policy (Audit M-1).
//
// The minimum used to be a flat 6 characters, copied independently into five
// call sites (auth.controller.js, admin.service.js, create-admin.js,
// create-warehouse.js and the Flutter client) - each free to drift from the
// others, and raising it in one place silently left the rest at 6.
//
// It is now one table, keyed by the role the credential actually belongs to,
// because the three roles are not equally valuable to an attacker:
//   - admin     controls approvals, warehouse creation, the ledger and the
//               exchange rate: the highest bar in the system;
//   - warehouse controls one warehouse's catalogue, prices and money;
//   - pharmacy  controls one pharmacy's own orders.
//
// Deliberately length-only, with no character-class requirement: a forced
// symbol reliably produces "Password1!" rather than a stronger secret, and
// length is what actually costs an attacker work. If a rejected-password
// deny-list is wanted later, this is the one place to add it - every caller
// already routes through assertPasswordPolicy.
const { ApiError } = require('./ApiError');

const MIN_PASSWORD_LENGTH_BY_ROLE = Object.freeze({
  pharmacy: 8,
  warehouse: 10,
  admin: 12,
});

// Anything unrecognised is held to the pharmacy bar rather than to no bar at
// all - a new role added to user.model.js without a line here still gets a
// real minimum instead of silently accepting a 1-character password.
const DEFAULT_ROLE = 'pharmacy';

function minPasswordLengthFor(role) {
  return MIN_PASSWORD_LENGTH_BY_ROLE[role] ?? MIN_PASSWORD_LENGTH_BY_ROLE[DEFAULT_ROLE];
}

// Throws ApiError.badRequest unless `password` meets the minimum for `role`.
// Returns the password unchanged so it can be used inline.
//
// `code` is the machine-readable ApiError code the caller wants on failure
// (the admin panel and the Flutter client map their own strings off it); the
// message always names the actual number of characters required, so a
// warehouse form never tells the admin "at least 8" while the server wants 10.
function assertPasswordPolicy(password, { role = DEFAULT_ROLE, code } = {}) {
  const min = minPasswordLengthFor(role);
  if (typeof password !== 'string' || password.length < min) {
    throw ApiError.badRequest(`Password must be at least ${min} characters.`, undefined, code);
  }
  return password;
}

module.exports = {
  MIN_PASSWORD_LENGTH_BY_ROLE,
  minPasswordLengthFor,
  assertPasswordPolicy,
};
