const { serializeUser, serializePharmacy, serializeWarehouse } = require('./auth.viewmodel');

function toPendingAccountItem({ user, pharmacy, warehouse }) {
  return {
    user: serializeUser(user),
    pharmacy: serializePharmacy(pharmacy),
    warehouse: serializeWarehouse(warehouse),
  };
}

function toPendingAccountsResponse(items) {
  return { accounts: items.map(toPendingAccountItem) };
}

// The Accounts management page needs the same {user, pharmacy, warehouse} shape
// plus the account's creation date for its "Created" column. `createdAt` is not
// part of the shared serializeUser (it's dead weight on every auth response), so
// it's spread on here from the lean User the service already selected it onto.
function toAccountItem({ user, pharmacy, warehouse }) {
  return {
    user: { ...serializeUser(user), createdAt: user.createdAt },
    pharmacy: serializePharmacy(pharmacy),
    warehouse: serializeWarehouse(warehouse),
  };
}

function toAccountsResponse(items) {
  return { accounts: items.map(toAccountItem) };
}

module.exports = { toPendingAccountsResponse, toAccountsResponse };
