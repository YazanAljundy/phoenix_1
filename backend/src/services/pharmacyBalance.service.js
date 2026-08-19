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
    ExchangeRate.findById(EXCHANGE_RATE_SINGLETON_ID),
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

// Every pharmacy currently in debt to this warehouse (balanceUsd > 0),
// highest debt first. A balance of exactly 0 or a negative one (a credit)
// never appears here - see the module-level notes on the two list functions
// in this file for why negative balances are a detail-view-only concept.
async function listDebtorsForWarehouse(warehouseId) {
  const balances = await PharmacyBalance.find({ warehouseId, balanceUsd: { $gt: 0 } }).sort({
    balanceUsd: -1,
  });
  const pharmacyIds = balances.map((b) => b.pharmacyId);
  const pharmacies = await Pharmacy.find({ _id: { $in: pharmacyIds } });
  const pharmacyById = new Map(pharmacies.map((p) => [p._id.toString(), p]));

  return balances
    .map((balance) => ({ balance, pharmacy: pharmacyById.get(balance.pharmacyId.toString()) ?? null }))
    .filter((row) => row.pharmacy !== null);
}

// Every warehouse this pharmacy currently owes (balanceUsd > 0), highest
// debt first - the pharmacy-facing mirror of listDebtorsForWarehouse above.
async function listDebtsForPharmacy(pharmacyId) {
  const balances = await PharmacyBalance.find({ pharmacyId, balanceUsd: { $gt: 0 } }).sort({
    balanceUsd: -1,
  });
  const warehouseIds = balances.map((b) => b.warehouseId);
  const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } });
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
    Pharmacy.findById(pharmacyId),
    Warehouse.findById(warehouseId),
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
  listDebtorsForWarehouse,
  listDebtsForPharmacy,
  getBalanceDetail,
};
