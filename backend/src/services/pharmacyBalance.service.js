const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Order = require('../models/order.model');
const Payment = require('../models/payment.model');
const PharmacyBalance = require('../models/pharmacyBalance.model');
const ExchangeRate = require('../models/exchangeRate.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');

const EXCHANGE_RATE_SINGLETON_ID = 'singleton';

function round2(amount) {
  return Math.round(amount * 100) / 100;
}

// Orders are always priced in SYP, locked in at order time (see
// order.service.js) - there's no per-order historical rate stored, so this
// converts through TODAY's live singleton rate, same as a payment recorded
// in SYP just below. Both sides of the ledger cash out through the same
// current rate, which keeps the comparison internally consistent even
// though it isn't a historically exact conversion.
function sypToUsd(amountSyp, usdToSyp) {
  return usdToSyp ? amountSyp / usdToSyp : 0;
}

function paymentAmountToUsd(amount, currency, usdToSyp) {
  return currency === 'USD' ? amount : sypToUsd(amount, usdToSyp);
}

// Rebuilds the (pharmacyId, warehouseId) cache from scratch - full recount
// of every delivered order and every payment for the pair, rather than an
// incremental delta. The data set per pair is small enough that this is
// simpler and safer than keeping a running adjustment in sync (no risk of
// drift from a missed hook). Called after: an order transitions to
// 'delivered' (warehouseOrder.service.js), and any payment create/update/
// delete (payment.service.js).
async function recomputeBalance(pharmacyId, warehouseId) {
  const [rate, orders, payments] = await Promise.all([
    ExchangeRate.findById(EXCHANGE_RATE_SINGLETON_ID).select('usdToSyp'),
    Order.find({ pharmacyId, warehouseId, status: 'delivered' }, 'finalPrice'),
    Payment.find({ pharmacyId, warehouseId }, 'amount currency'),
  ]);
  const usdToSyp = rate ? rate.usdToSyp : null;

  const totalOrdersUsd = orders.reduce((sum, order) => sum + sypToUsd(order.finalPrice, usdToSyp), 0);
  const totalPaidUsd = payments.reduce(
    (sum, payment) => sum + paymentAmountToUsd(payment.amount, payment.currency, usdToSyp),
    0
  );
  const balanceUsd = totalOrdersUsd - totalPaidUsd;

  return PharmacyBalance.findOneAndUpdate(
    { pharmacyId, warehouseId },
    {
      totalOrdersUsd: round2(totalOrdersUsd),
      totalPaidUsd: round2(totalPaidUsd),
      balanceUsd: round2(balanceUsd),
      lastUpdated: new Date(),
    },
    { upsert: true, new: true }
  );
}

// The "Invoices" list: every pharmacy that has ever had a DELIVERED order from
// this warehouse - i.e. every completed purchase relationship - regardless of
// its current balance (in debt, settled at 0, or a credit).
//
// The source of truth is `orders`, not `pharmacybalances`: a PharmacyBalance
// row is normally created by recomputeBalance on the first delivery, but that
// call is best-effort (warehouseOrder.service.js swallows its failures), so a
// pharmacy CAN have a delivered order and no balance row yet. Such a pharmacy
// must still appear, with balance 0 - and we never create the row here just to
// list it (getBalanceDetail does the same read-only 0-fallback).
const WAREHOUSE_DEBTORS_DEFAULT_LIMIT = 20;

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

// balanceUsd is a live, mutable value (it moves as payments/deliveries come
// in), not a monotonic id - unlike every other paginated list here, a plain
// "greater/less than the last cursor" isn't enough on its own, since ties on
// balanceUsd are possible and a single-field cursor could skip or repeat a
// row across pages. The cursor is the pair (balanceUsd, pharmacyId): "the next
// row is either a strictly lower balance, or the same balance with a higher
// pharmacyId" - the id only breaks ties, it carries no meaning of its own.
async function listPaginatedDebtorsForWarehouse(
  warehouseId,
  { limit = WAREHOUSE_DEBTORS_DEFAULT_LIMIT, after = null } = {}
) {
  const whId = toObjectId(warehouseId);

  const pipeline = [
    // 1. Unique pharmacies with a completed (delivered) purchase here.
    //    Uses the {warehouseId, status, ...} index for the match.
    { $match: { warehouseId: whId, status: 'delivered' } },
    { $group: { _id: '$pharmacyId' } },
    // 2. Attach the cached balance for this (pharmacy, warehouse) pair, if any.
    {
      $lookup: {
        from: PharmacyBalance.collection.name,
        let: { pid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $and: [{ $eq: ['$pharmacyId', '$$pid'] }, { $eq: ['$warehouseId', whId] }] },
            },
          },
          { $project: { _id: 0, balanceUsd: 1, totalOrdersUsd: 1, totalPaidUsd: 1 } },
        ],
        as: 'bal',
      },
    },
    // 3. No row yet -> 0, for this response only (never persisted here).
    {
      $addFields: {
        balanceUsd: { $ifNull: [{ $arrayElemAt: ['$bal.balanceUsd', 0] }, 0] },
        totalOrdersUsd: { $ifNull: [{ $arrayElemAt: ['$bal.totalOrdersUsd', 0] }, 0] },
        totalPaidUsd: { $ifNull: [{ $arrayElemAt: ['$bal.totalPaidUsd', 0] }, 0] },
      },
    },
  ];

  // 4. Cursor: everything that sorts after `after` in (balanceUsd desc, id asc).
  if (after !== null) {
    pipeline.push({
      $match: {
        $or: [
          { balanceUsd: { $lt: after.balanceUsd } },
          { balanceUsd: after.balanceUsd, _id: { $gt: toObjectId(after.id) } },
        ],
      },
    });
  }

  pipeline.push({ $sort: { balanceUsd: -1, _id: 1 } });
  pipeline.push({ $limit: limit + 1 });
  // 5. Pharmacy display fields (pure-pipeline $lookup for wide compatibility).
  pipeline.push({
    $lookup: {
      from: Pharmacy.collection.name,
      let: { pid: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$pid'] } } },
        { $project: { nameAr: 1, nameEn: 1, phone: 1 } },
      ],
      as: 'pharmacy',
    },
  });

  const docs = await Order.aggregate(pipeline);

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor =
    page.length > 0
      ? JSON.stringify({
          balanceUsd: page[page.length - 1].balanceUsd,
          id: String(page[page.length - 1]._id),
        })
      : null;

  const rows = page
    .map((doc) => ({
      // Same shape serializeDebtorRow expects: a `balance` with the three
      // figures + a `pharmacy` with id/names/phone.
      balance: {
        pharmacyId: doc._id,
        totalOrdersUsd: doc.totalOrdersUsd,
        totalPaidUsd: doc.totalPaidUsd,
        balanceUsd: doc.balanceUsd,
      },
      pharmacy: doc.pharmacy[0] ?? null,
    }))
    .filter((row) => row.pharmacy !== null);

  return { rows, hasMore, nextCursor };
}

// Every warehouse this pharmacy currently owes (balanceUsd > 0), highest
// debt first - the pharmacy-facing mirror of listDebtorsForWarehouse above.
async function listDebtsForPharmacy(pharmacyId) {
  const balances = await PharmacyBalance.find({ pharmacyId, balanceUsd: { $gt: 0 } }).sort({
    balanceUsd: -1,
  });
  const warehouseIds = balances.map((b) => b.warehouseId);
  // pharmacyBalance.viewmodel.js's serializeDebtRow shows the warehouse's two
  // names and phone.
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } }).select('nameAr nameEn phone');
  const warehouseById = new Map(warehouses.map((w) => [w._id.toString(), w]));

  return balances
    .map((balance) => ({ balance, warehouse: warehouseById.get(balance.warehouseId.toString()) ?? null }))
    .filter((row) => row.warehouse !== null);
}

// Detail for one (pharmacy, warehouse) pair - always the true balance
// regardless of sign (unlike the two list functions above, which only
// surface debtors). A negative balanceUsd here means this pharmacy has paid
// ahead of what it owes; the caller renders that as a credit, not a debt.
// Falls back to a zeroed shape if recomputeBalance has never run for this
// pair yet (no delivered order and no payment ever recorded).
//
// Fetches both `pharmacy` and `warehouse` regardless of which side is
// calling (warehouseBalance vs pharmacyDebt controllers) - each viewmodel
// just picks whichever one is "the other party" for its own caller.
async function getBalanceDetail(pharmacyId, warehouseId) {
  if (
    !mongoose.Types.ObjectId.isValid(pharmacyId) ||
    !mongoose.Types.ObjectId.isValid(warehouseId)
  ) {
    throw ApiError.notFound('Balance not found.', 'BALANCE_NOT_FOUND');
  }

  const [balance, orders, payments, pharmacy, warehouse] = await Promise.all([
    PharmacyBalance.findOne({ pharmacyId, warehouseId }),
    Order.find({ pharmacyId, warehouseId, status: 'delivered' }, 'orderNumber finalPrice createdAt').sort({
      orderNumber: -1,
    }),
    Payment.find({ pharmacyId, warehouseId }).sort({ createdAt: -1 }),
    // toBalanceDetailResponse shows only the "other party" - its id, two names
    // and phone.
    Pharmacy.findById(pharmacyId).select('nameAr nameEn phone'),
    Warehouse.findById(warehouseId).select('nameAr nameEn phone'),
  ]);

  if (!pharmacy || !warehouse) {
    throw ApiError.notFound('Balance not found.', 'BALANCE_NOT_FOUND');
  }

  return {
    balance:
      balance ??
      new PharmacyBalance({ pharmacyId, warehouseId, totalOrdersUsd: 0, totalPaidUsd: 0, balanceUsd: 0 }),
    orders,
    payments,
    pharmacy,
    warehouse,
  };
}

module.exports = {
  recomputeBalance,
  listPaginatedDebtorsForWarehouse,
  listDebtsForPharmacy,
  getBalanceDetail,
};
