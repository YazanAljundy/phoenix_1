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

module.exports = { toPendingAccountsResponse };
