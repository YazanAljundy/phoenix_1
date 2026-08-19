// One-time backfill (Section 16): pharmacy_balances is a cache, kept up to
// date going forward by recomputeBalance's hooks (a delivered order,
// or any payment create/update/delete - see warehouseOrder.service.js and
// payment.service.js). Any order that was already 'delivered' before this
// feature existed never triggered that hook, so it's missing from the cache
// entirely until this runs once. Same pattern as
// backfill-warehouse-manufacturers.js / migrate-prices-to-usd.js.
//
// Usage: npm run backfill-pharmacy-balances
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Order = require('../src/models/order.model');
const { recomputeBalance } = require('../src/services/pharmacyBalance.service');

async function main() {
  await mongoose.connect(env.mongodbUri);

  const orders = await Order.find({ status: 'delivered' }, 'pharmacyId warehouseId');

  const pairs = new Map(); // `${pharmacyId}:${warehouseId}` -> { pharmacyId, warehouseId }
  for (const order of orders) {
    const key = `${order.pharmacyId}:${order.warehouseId}`;
    pairs.set(key, { pharmacyId: order.pharmacyId, warehouseId: order.warehouseId });
  }

  let updated = 0;
  for (const { pharmacyId, warehouseId } of pairs.values()) {
    await recomputeBalance(pharmacyId, warehouseId);
    updated += 1;
  }

  console.log(
    `Backfilled ${updated} (pharmacy, warehouse) balance(s) from ${orders.length} delivered order(s).`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
