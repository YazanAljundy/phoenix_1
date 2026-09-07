const mongoose = require('mongoose');
const Order = require('../models/order.model');
const LedgerEntry = require('../models/ledgerEntry.model');

// Money-Flow V2. What a warehouse owes the platform, and what it actually
// nets, for a period.
//
// V1 computed `commissionAmount` on every order and then read it nowhere: dead
// financial data. This gives it a reader without inventing a collection flow
// that does not exist operationally - it is a REPORT over frozen order fields,
// not a second ledger. Nothing here posts an entry or moves a balance.
//
// The figures, per delivered order in the period:
//
//   sales       = order.finalPrice          (what the pharmacy was charged)
//   commission  = order.commissionSyp       (1% of finalPrice, frozen at order time)
//   net         = sales - commission        (what the warehouse keeps)
//
// less, for anything credited back on a return:
//
//   creditedSales      = the return credit
//   commissionClawback = commission x (credit / finalPrice)
//
// so a warehouse is not charged commission on money it never collected.

function round(amount) {
  return Math.round(amount);
}

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

// Defaults to the current calendar month, which is the period a warehouse
// actually settles on.
function resolvePeriod({ from, to } = {}) {
  const now = new Date();
  const start = from
    ? new Date(from)
    : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = to ? new Date(to) : now;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now, invalid: true };
  }
  return { from: start, to: end, invalid: false };
}

// The commission attributable to a credited return: the same proportion of the
// order's frozen commission as the credit is of the order's final price.
// Rounded once, and clamped so a full credit can never claw back more than was
// charged in the first place.
function commissionClawbackFor(order, creditSyp) {
  if (!order || !order.finalPrice || !order.commissionAmount) return 0;
  const share = Math.min(1, creditSyp / order.finalPrice);
  return Math.min(order.commissionAmount, round(order.commissionAmount * share));
}

async function getSettlementForWarehouse(warehouseId, { from, to } = {}) {
  const period = resolvePeriod({ from, to });
  const whId = toObjectId(warehouseId);

  // Delivered orders in the period. `deliveredAt` is the business date the
  // charge was posted on, so it is what a settlement period is cut by -
  // createdAt would put an order in the month it was placed rather than the
  // month it was billed.
  const orders = await Order.find({
    warehouseId: whId,
    status: 'delivered',
    deliveredAt: { $gte: period.from, $lte: period.to },
  })
    .select('orderNumber invoiceNumber deliveredAt totalPrice discountAmount advertisementDiscountAmount finalPrice commissionAmount pharmacyId')
    .sort({ deliveredAt: 1 })
    .lean();

  const orderIds = orders.map((order) => order._id);
  const orderById = new Map(orders.map((order) => [String(order._id), order]));

  // Credits raised against those orders, whenever they were raised - a return
  // credited in October against a September order reduces the commission on
  // the order it belongs to, which is how a clawback has to work.
  const credits = orderIds.length
    ? await LedgerEntry.find({
        kind: 'return_credit',
        'metadata.orderId': { $in: orderIds },
      })
        .select('amountSyp effectiveAt metadata')
        .lean()
    : [];

  const creditByOrderId = new Map();
  for (const credit of credits) {
    const key = String(credit.metadata.orderId);
    creditByOrderId.set(key, (creditByOrderId.get(key) ?? 0) + credit.amountSyp);
  }

  let grossSalesSyp = 0;
  let grossCommissionSyp = 0;
  let creditedSalesSyp = 0;
  let commissionClawbackSyp = 0;

  const rows = orders.map((order) => {
    const creditSyp = creditByOrderId.get(String(order._id)) ?? 0;
    const clawbackSyp = commissionClawbackFor(order, creditSyp);
    const netSalesSyp = order.finalPrice - creditSyp;
    const netCommissionSyp = order.commissionAmount - clawbackSyp;

    grossSalesSyp += order.finalPrice;
    grossCommissionSyp += order.commissionAmount;
    creditedSalesSyp += creditSyp;
    commissionClawbackSyp += clawbackSyp;

    return {
      orderId: order._id,
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber ?? null,
      deliveredAt: order.deliveredAt,
      pharmacyId: order.pharmacyId,
      // The full pricing story for one line of the report.
      subtotalSyp: order.totalPrice,
      platformDiscountSyp: order.discountAmount,
      advertisementDiscountSyp: order.advertisementDiscountAmount ?? 0,
      salesSyp: order.finalPrice,
      commissionSyp: order.commissionAmount,
      creditedSyp: creditSyp,
      commissionClawbackSyp: clawbackSyp,
      netSalesSyp,
      netCommissionSyp,
      // What the warehouse keeps on this order.
      warehouseNetSyp: netSalesSyp - netCommissionSyp,
    };
  });

  const netSalesSyp = grossSalesSyp - creditedSalesSyp;
  const netCommissionSyp = grossCommissionSyp - commissionClawbackSyp;

  return {
    period: { from: period.from, to: period.to },
    totals: {
      orderCount: orders.length,
      // Sales: what pharmacies were charged for delivered orders.
      grossSalesSyp,
      // Returns credited back against those orders.
      creditedSalesSyp,
      netSalesSyp,
      // Commission: what the platform is owed, before and after clawback.
      grossCommissionSyp,
      commissionClawbackSyp,
      netCommissionSyp,
      // What the warehouse keeps. Deliberately the last figure, because it is
      // the one a warehouse actually plans around.
      warehouseNetSyp: netSalesSyp - netCommissionSyp,
    },
    rows,
  };
}

module.exports = { getSettlementForWarehouse, commissionClawbackFor, resolvePeriod };
