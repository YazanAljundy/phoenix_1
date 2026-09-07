const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const CommissionCollection = require('../models/commissionCollection.model');
const Warehouse = require('../models/warehouse.model');
const { getSettlementForWarehouse, resolvePeriod } = require('./settlement.service');
const { METHODS } = require('./payment.service');
const financialAudit = require('./financialAudit.service');

// The platform's side of commission: who owes what across every warehouse, and
// a record of when one of them actually paid.
//
// What is DERIVED and what is STORED matters here:
//
//   commission owed  -> derived, every time, by settlement.service.js from the
//                       frozen order fields. Never stored, so it can never go
//                       stale or disagree with the orders behind it.
//   collections      -> stored, because "someone handed over money" is a fact
//                       no computation can derive.
//
// Everything below reuses getSettlementForWarehouse rather than restating its
// formula - the clawback rule in particular (a credited return reduces the
// commission on its own order) lives in exactly one place.

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validateAmount(amountSyp) {
  if (typeof amountSyp !== 'number' || !Number.isFinite(amountSyp) || amountSyp <= 0) {
    throw ApiError.badRequest(
      'Invalid collection amount.',
      undefined,
      'INVALID_COLLECTION_AMOUNT'
    );
  }
  // Whole lira, like every other settlement figure.
  return Math.round(amountSyp);
}

function validateMethod(method) {
  if (method === undefined || method === null) return 'cash';
  if (!METHODS.includes(method)) {
    throw ApiError.badRequest('Invalid payment method.', undefined, 'INVALID_PAYMENT_METHOD');
  }
  return method;
}

function parseDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(`Invalid ${field}.`, undefined, 'INVALID_COLLECTION_PERIOD');
  }
  return date;
}

function validatePeriod(periodFrom, periodTo) {
  const from = parseDate(periodFrom, 'period start');
  const to = parseDate(periodTo, 'period end');
  if (to < from) {
    throw ApiError.badRequest(
      'The period end cannot be before its start.',
      undefined,
      'INVALID_COLLECTION_PERIOD'
    );
  }
  return { from, to };
}

async function loadWarehouseOrThrow(warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
    throw ApiError.notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND');
  }
  const warehouse = await Warehouse.findById(warehouseId).select('nameAr nameEn phone').lean();
  if (!warehouse) {
    throw ApiError.notFound('Warehouse not found.', 'WAREHOUSE_NOT_FOUND');
  }
  return warehouse;
}

// Two date ranges overlap when each starts before the other ends. Written as a
// Mongo filter so the sum is one indexed query rather than a fetch-and-filter.
//
// A collection counts toward a range if its window touches that range AT ALL -
// a warehouse that paid for a whole quarter has settled part of any month
// inside it. Partial-overlap apportioning would need the collection to carry a
// per-day breakdown it does not have, and inventing one would be a guess.
function overlappingPeriod(from, to) {
  return { periodFrom: { $lte: to }, periodTo: { $gte: from } };
}

async function collectedForWarehouse(warehouseId, from, to) {
  const [row] = await CommissionCollection.aggregate([
    {
      $match: {
        warehouseId: new mongoose.Types.ObjectId(String(warehouseId)),
        status: 'recorded',
        ...overlappingPeriod(from, to),
      },
    },
    { $group: { _id: null, total: { $sum: '$amountSyp' } } },
  ]);
  return Math.round(row?.total ?? 0);
}

// One warehouse's commission position for a range: what it owes, what it has
// already paid against that range, and the difference.
async function getWarehouseCommission(warehouse, period) {
  const settlement = await getSettlementForWarehouse(warehouse._id, {
    from: period.from,
    to: period.to,
  });
  const alreadyCollectedSyp = await collectedForWarehouse(warehouse._id, period.from, period.to);

  // `netCommissionSyp` is already net of the pro-rata clawback on credited
  // returns - that is what the warehouse genuinely owes before anything is
  // collected. Renamed here to the vocabulary the admin screen speaks.
  const commissionOwedSyp = settlement.totals.netCommissionSyp;

  return {
    warehouseId: warehouse._id,
    warehouse,
    orderCount: settlement.totals.orderCount,
    salesSyp: settlement.totals.grossSalesSyp,
    returnsSyp: settlement.totals.creditedSalesSyp,
    commissionOwedSyp,
    alreadyCollectedSyp,
    // Can go negative when a warehouse has over-paid, or paid for a wider
    // window than the one being viewed. Reported as-is rather than clamped:
    // a negative here is information, and hiding it would make an overpayment
    // look like a settled account.
    outstandingSyp: commissionOwedSyp - alreadyCollectedSyp,
  };
}

// The cross-warehouse overview: the same per-warehouse settlement computation
// Step 6 built, run across every warehouse for one admin-chosen range, plus
// the collection layer.
//
// Every warehouse is listed, including those that sold nothing in the range -
// an admin scanning for who owes what needs the zeroes to be visibly zero
// rather than absent and ambiguous.
async function getCommissionOverview({ from, to } = {}) {
  const period = resolvePeriod({ from, to });
  const warehouses = await Warehouse.find({}).select('nameAr nameEn phone isActive').lean();

  const rows = await Promise.all(
    warehouses.map((warehouse) => getWarehouseCommission(warehouse, period))
  );

  // Most-owing first, which is the order an admin actually works through.
  rows.sort((a, b) => b.outstandingSyp - a.outstandingSyp);

  const totals = rows.reduce(
    (acc, row) => ({
      salesSyp: acc.salesSyp + row.salesSyp,
      returnsSyp: acc.returnsSyp + row.returnsSyp,
      commissionOwedSyp: acc.commissionOwedSyp + row.commissionOwedSyp,
      alreadyCollectedSyp: acc.alreadyCollectedSyp + row.alreadyCollectedSyp,
      outstandingSyp: acc.outstandingSyp + row.outstandingSyp,
    }),
    { salesSyp: 0, returnsSyp: 0, commissionOwedSyp: 0, alreadyCollectedSyp: 0, outstandingSyp: 0 }
  );

  return { period, totals, rows };
}

// One warehouse's detail: the same figures as its overview row, plus the
// per-order settlement breakdown and its collection history.
async function getWarehouseCommissionDetail(warehouseId, { from, to } = {}) {
  const warehouse = await loadWarehouseOrThrow(warehouseId);
  const period = resolvePeriod({ from, to });

  const [summary, settlement, collections] = await Promise.all([
    getWarehouseCommission(warehouse, period),
    getSettlementForWarehouse(warehouse._id, { from: period.from, to: period.to }),
    // The full history, not just the range: a reversed collection from outside
    // the window still explains why an outstanding figure moved.
    listCollectionsForWarehouse(warehouse._id),
  ]);

  return { period, warehouse, summary, orders: settlement.rows, collections };
}

async function listCollectionsForWarehouse(warehouseId, { limit = 100 } = {}) {
  return CommissionCollection.find({ warehouseId })
    .sort({ recordedAt: -1, _id: -1 })
    .limit(limit)
    .lean();
}

// Records that a warehouse paid its commission.
//
// No transaction, no CAS, no idempotency key - deliberately. Those exist on
// the pharmacy paths because those are high-frequency, racy, and move a
// pharmacy's balance. This is an admin typing one bookkeeping row: a duplicate
// is visible in the history and reversible, which is proportionate. It is
// still audited, because every financial mutation is.
async function recordCollection({
  warehouseId,
  periodFrom,
  periodTo,
  amountSyp,
  method,
  reference,
  note,
  actorId,
}) {
  const warehouse = await loadWarehouseOrThrow(warehouseId);
  const amount = validateAmount(amountSyp);
  const period = validatePeriod(periodFrom, periodTo);
  const resolvedMethod = validateMethod(method);

  const collection = await CommissionCollection.create({
    warehouseId: warehouse._id,
    periodFrom: period.from,
    periodTo: period.to,
    amountSyp: amount,
    method: resolvedMethod,
    reference: normalizeText(reference),
    note: normalizeText(note),
    recordedBy: actorId,
    recordedAt: new Date(),
    status: 'recorded',
  });

  await financialAudit.record({
    action: 'commission.collected',
    actorId,
    actorRole: 'admin',
    onBehalfOfWarehouseId: warehouse._id,
    entityType: 'CommissionCollection',
    entityId: collection._id,
    after: {
      amountSyp: amount,
      method: resolvedMethod,
      periodFrom: period.from,
      periodTo: period.to,
    },
  });

  return collection;
}

// Undoes a collection recorded in error. The row is kept and stays visible in
// the history, struck through with its reason - the same treatment a reversed
// pharmacy payment gets. Once reversed it no longer counts toward
// alreadyCollectedSyp, so the warehouse's outstanding amount goes back up.
async function reverseCollection({ collectionId, reason, actorId }) {
  const trimmedReason = normalizeText(reason);
  if (!trimmedReason) {
    throw ApiError.badRequest(
      'A reason is required to reverse a collection.',
      undefined,
      'REASON_REQUIRED'
    );
  }
  if (!mongoose.Types.ObjectId.isValid(collectionId)) {
    throw ApiError.notFound('Collection not found.', 'COLLECTION_NOT_FOUND');
  }

  const existing = await CommissionCollection.findById(collectionId);
  if (!existing) {
    throw ApiError.notFound('Collection not found.', 'COLLECTION_NOT_FOUND');
  }

  // Guarded as a conditional update rather than a read-then-save, so a second
  // reversal matches zero documents instead of overwriting the first one's
  // reason and actor.
  const reversed = await CommissionCollection.findOneAndUpdate(
    { _id: existing._id, status: 'recorded' },
    {
      $set: {
        status: 'reversed',
        reversedBy: actorId,
        reversedAt: new Date(),
        reversalReason: trimmedReason,
      },
    },
    { new: true }
  );
  if (!reversed) {
    throw ApiError.conflict(
      'This collection has already been reversed.',
      'COLLECTION_ALREADY_REVERSED'
    );
  }

  await financialAudit.record({
    action: 'commission.collection_reversed',
    actorId,
    actorRole: 'admin',
    onBehalfOfWarehouseId: reversed.warehouseId,
    entityType: 'CommissionCollection',
    entityId: reversed._id,
    before: { status: 'recorded', amountSyp: reversed.amountSyp },
    after: { status: 'reversed' },
    reason: trimmedReason,
  });

  return reversed;
}

module.exports = {
  getCommissionOverview,
  getWarehouseCommissionDetail,
  listCollectionsForWarehouse,
  recordCollection,
  reverseCollection,
  collectedForWarehouse,
};
