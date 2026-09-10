// One-time migration: packages on an order became "locked groups".
//
// Before this, an order that came from a package carried only
// `advertisementId` + `advertisementDiscountAmount`, and its package products
// were ordinary, editable lines indistinguishable from any other. Every
// re-pricing therefore had to go back and read the LIVE Advertisement, which
// meant a package edited (or expired, or deleted) after the fact could restate
// an order the pharmacy had already placed.
//
// Now each package is an entry in `Order.orderPackageGroups` carrying a
// snapshot of the terms actually agreed - the package price, what it contains,
// and the exchange rate the order was priced through - and every line it owns
// points back at it via `OrderItem.packageGroupId`. Nothing re-reads the
// Advertisement afterwards.
//
// What this script does, per legacy order:
//   1. Reads the order's Advertisement to recover what the package contained.
//   2. Builds the snapshot from it plus the order's OWN frozen fx.rate.
//   3. Tags the matching OrderItem rows with the new group's id.
//   4. Splits a line that holds MORE units than the package advertised: the
//      original row keeps its id (so existing Return references stay valid)
//      and drops to the advertised quantity, and a new row carries the
//      remainder at the SAME stored price. No money moves - the two rows sum
//      to exactly what the one row cost.
//
// Money is never recomputed. `totalPrice`, `discountAmount`,
// `advertisementDiscountAmount`, `finalPrice` and `commissionAmount` are left
// exactly as they are: the point is to describe existing orders in the new
// shape, not to re-price them. The script verifies afterwards that the group
// it wrote reproduces the discount already stored, and reports any order where
// it does not instead of "fixing" it.
//
// Both shapes are readable throughout: an order with no groups simply has none
// and behaves as an ordinary order, so this can run at any point after deploy
// rather than in lockstep with it.
//
// Safe to re-run: an order that already has groups is skipped.
//
// Usage: node scripts/migrate-order-package-groups.js [--dry-run]
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Advertisement = require('../src/models/advertisement.model');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(env.mongodbUri);
  if (DRY_RUN) console.log('DRY RUN - nothing will be written.\n');

  // Legacy package orders only: an advertisementId, and no groups yet.
  const orders = await Order.find({
    advertisementId: { $ne: null },
    $or: [{ orderPackageGroups: { $size: 0 } }, { orderPackageGroups: { $exists: false } }],
  });
  console.log(`Found ${orders.length} legacy package order(s).`);

  let migrated = 0;
  let splitLines = 0;
  const skipped = [];
  const mismatched = [];

  for (const order of orders) {
    const advertisement = await Advertisement.findById(order.advertisementId);
    if (!advertisement) {
      // The package was deleted outright, so there is nothing left to
      // reconstruct the snapshot from. Left alone rather than guessed at: the
      // order's stored money is still correct and still displays fine.
      skipped.push({ orderNumber: order.orderNumber, reason: 'advertisement deleted' });
      continue;
    }

    // The rate the order was actually priced through. An order old enough to
    // predate fx capture has none - without it the snapshot cannot convert the
    // package total, so it is left alone too.
    const usdToSyp = order.fx?.rate ?? null;
    if (!usdToSyp) {
      skipped.push({ orderNumber: order.orderNumber, reason: 'no frozen fx rate' });
      continue;
    }

    const items = await OrderItem.find({ orderId: order._id });
    const lineByProductId = new Map(items.map((item) => [item.productId.toString(), item]));

    const missing = advertisement.items.find(
      (item) => !lineByProductId.has(item.productId.toString())
    );
    if (missing) {
      // The order no longer holds one of the package's products (a warehouse
      // edit dropped it back when that was possible), so it is not really a
      // package order any more.
      skipped.push({ orderNumber: order.orderNumber, reason: 'package product not on order' });
      continue;
    }

    const groupId = new mongoose.Types.ObjectId();
    const writes = [];
    const newRows = [];
    let groupLinesSyp = 0;

    for (const packageItem of advertisement.items) {
      const line = lineByProductId.get(packageItem.productId.toString());
      const advertisedUnits = packageItem.quantity;
      groupLinesSyp += line.discountPrice * advertisedUnits;

      if (line.quantity > advertisedUnits) {
        // Extras beyond the package. They stay on the order as a loose,
        // editable line at the price they were already charged.
        const remainder = line.quantity - advertisedUnits;
        splitLines += 1;
        newRows.push({
          orderId: order._id,
          packageGroupId: null,
          productId: line.productId,
          productNameAr: line.productNameAr,
          productNameEn: line.productNameEn,
          manufacturerAr: line.manufacturerAr,
          manufacturerEn: line.manufacturerEn,
          quantity: remainder,
          unitPrice: line.unitPrice,
          discountPrice: line.discountPrice,
          savingsUsd: 0,
          savingsSyp: 0,
        });
        writes.push({ line, quantity: advertisedUnits });
      } else {
        writes.push({ line, quantity: line.quantity });
      }
    }

    const group = {
      _id: groupId,
      advertisementId: advertisement._id,
      advertisementSnapshot: {
        titleAr: advertisement.titleAr,
        titleEn: advertisement.titleEn,
        totalPriceUsd: advertisement.totalPriceUsd,
        items: advertisement.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        usdToSyp,
      },
      copies: 1,
      totalPriceUsd: advertisement.totalPriceUsd,
    };

    // Does the new shape reproduce the discount the order already carries? If
    // not, something about this order is not what the new model assumes, and
    // it is reported rather than quietly rewritten.
    const expectedDiscount = Math.max(
      0,
      groupLinesSyp - Math.round(advertisement.totalPriceUsd * usdToSyp)
    );
    const storedDiscount = order.advertisementDiscountAmount ?? 0;
    if (expectedDiscount !== storedDiscount) {
      mismatched.push({
        orderNumber: order.orderNumber,
        stored: storedDiscount,
        recomputed: expectedDiscount,
      });
      continue;
    }

    if (!DRY_RUN) {
      for (const { line, quantity } of writes) {
        line.quantity = quantity;
        line.packageGroupId = groupId;
        await line.save();
      }
      if (newRows.length > 0) await OrderItem.insertMany(newRows);
      order.orderPackageGroups = [group];
      // The complete package list, kept in step with the groups. A legacy
      // order has exactly one, so this matches the singular mirror it already
      // carries - but code that attributes money reads this rather than that.
      order.advertisementIds = [advertisement._id];
      await order.save();
    }
    migrated += 1;
  }

  console.log(`\nMigrated ${migrated} order(s) into package groups.`);
  if (splitLines > 0) {
    console.log(`Split ${splitLines} line(s) that held units beyond the package.`);
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} order(s) - left in the legacy shape, still correct:`);
    for (const row of skipped) console.log(`  #${row.orderNumber}: ${row.reason}`);
  }
  if (mismatched.length > 0) {
    console.log(
      `\n${mismatched.length} order(s) did NOT reproduce their stored discount and were left untouched.`
    );
    console.log('Review these by hand before deciding what they should be:');
    for (const row of mismatched) {
      console.log(`  #${row.orderNumber}: stored ${row.stored}, recomputed ${row.recomputed}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect();
});
