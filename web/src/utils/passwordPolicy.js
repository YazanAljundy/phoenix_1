// The panel's mirror of the server's password policy.
//
// The authority is backend/src/utils/password.js, which holds this same table
// and is what actually rejects a weak password. This copy exists so the admin
// finds out in the form instead of after a round trip, and so the field can
// say what it wants before anything is typed.
//
// Keep the two in step. If they ever diverge, the server wins: a value that is
// too low here just means the request comes back 400.
export const MIN_PASSWORD_LENGTH_BY_ROLE = Object.freeze({
  pharmacy: 8,
  warehouse: 10,
  admin: 12,
});

// Unknown roles fall back to the strictest entry rather than the weakest: a
// role this panel has not been taught about is not a reason to wave a short
// password through.
const STRICTEST = Math.max(...Object.values(MIN_PASSWORD_LENGTH_BY_ROLE));

export function minPasswordLengthFor(role) {
  return MIN_PASSWORD_LENGTH_BY_ROLE[role] ?? STRICTEST;
}

// Returns null when the password satisfies `role`'s minimum, or the number of
// characters required when it does not - the caller turns that into its own
// translated message, so no strings live here.
export function passwordPolicyError(password, role) {
  const min = minPasswordLengthFor(role);
  if (typeof password !== 'string' || password.length < min) return min;
  return null;
}

// Whether the Accounts page offers an emergency password reset for an account
// of this role.
//
// Mirrors the server's own limit: admin.service.js routes the reset through
// findManageableAccountOrThrow, which reaches pharmacies and warehouses only.
// One admin resetting another admin's password would make every admin a
// lateral step to every other, so that is refused with a 404 - and a button
// whose only possible outcome is a 404 should not be on screen.
//
// Extracted as a plain function rather than left inline in the JSX so the rule
// is testable without a DOM, the same way accountsFilters.js holds the page's
// filter rules.
export function canAdminResetPassword(role) {
  return role === 'pharmacy' || role === 'warehouse';
}
