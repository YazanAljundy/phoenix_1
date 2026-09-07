const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Return = require('../models/return.model');
const Order = require('../models/order.model');
const Pharmacy = require('../models/pharmacy.model');
const { attachOrderContext } = require('./return.service');
const { valueReturn } = require('./returnCredit.service');
const { runInTransaction } = require('../utils/transaction');
const ledger = require('./ledger.service');
const financialAudit = require('./financialAudit.service');
const { emitToWarehouse, EVENTS } = require('../realtime');

const WAREHOUSE_RETURNS_DEFAULT_LIMIT = 15;

function validateStatusFilter(status) {
  if (status && !Return.schema.path('status').enumValues.includes(status)) {
    throw ApiError.badRequest('Invalid status filter.', undefined, 'INVALID_STATUS_FILTER');
  }
}

async function attachContextAndPharmacy(returns) {
  const [withOrderContext, pharmacies] = await Promise.all([
    attachOrderContext(returns),
    // warehouseReturn.viewmodel.js's serializeWarehouseReturn shows the
    // pharmacy's two names and phone.
    Pharmacy.find({ _id: { $in: [...new Set(returns.map((r) => r.pharmacyId.toString()))] } })
      .select('nameAr nameEn phone'),
  ]);
  const pharmacyById = new Map(pharmacies.map((p) => [p._id.toString(), p]));

  return withOrderContext.map((row) => ({
    ...row,
    pharmacy: pharmacyById.get(row.returnRequest.pharmacyId.toString()) ?? null,
  }));
}

// Section 13b: the warehouse's own return queue - every return for its
// warehouse (not just pending), same shape as listOffersForWarehouse: the
// action queue and the history are the same list, filtered client-side.
async function listReturnsForWarehouse(warehouseId, status) {
  validateStatusFilter(status);
  const filter = { warehouseId };
  if (status) filter.status = status;

  const returns = await Return.find(filter)
    .select(
      'orderId pharmacyId items notes images status rejectionNote creditSyp creditUsd creditEntryId resolvedAt createdAt'
    )
    .sort({ createdAt: 1 });
  if (returns.length === 0) return [];

  return attachContextAndPharmacy(returns);
}

// The Returns management page (unlike the callers of the unpaginated
// listReturnsForWarehouse above - WarehouseOrderDetailPage's "does this
// order already have a pending return" lookup, which needs every return)
// wants newest-first with "Load more". An ObjectId's embedded timestamp
// makes `_id` descending equivalent to `createdAt` descending.
async function listPaginatedReturnsForWarehouse(
  warehouseId,
  status,
  { limit = WAREHOUSE_RETURNS_DEFAULT_LIMIT, after = null } = {}
) {
  validateStatusFilter(status);
  const filter = { warehouseId };
  if (status) filter.status = status;
  if (after !== null) {
    filter._id = { $lt: after };
  }

  const returns = await Return.find(filter)
    .select(
      'orderId pharmacyId items notes images status rejectionNote creditSyp creditUsd creditEntryId resolvedAt createdAt'
    )
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = returns.length > limit;
  const page = hasMore ? returns.slice(0, limit) : returns;
  const nextCursor = page.length > 0 ? String(page[page.length - 1]._id) : null;

  if (page.length === 0) return { rows: [], hasMore: false, nextCursor: null };

  const rows = await attachContextAndPharmacy(page);
  return { rows, hasMore, nextCursor };
}

async function loadPendingReturnOrThrow(returnId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(returnId)) {
    throw ApiError.notFound('Return not found.', 'RETURN_NOT_FOUND');
  }
  const returnRequest = await Return.findOne({ _id: returnId, warehouseId, status: 'pending' });
  if (!returnRequest) {
    throw ApiError.notFound('Return not found.', 'RETURN_NOT_FOUND');
  }
  return returnRequest;
}

// IDOR guard: scoped to warehouseId, same pattern as loadPendingReturnOrThrow
// above - but any status, not just pending, since the detail page also needs
// to show an already-approved/rejected return's final state.
async function findOwnReturnOrThrow(returnId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(returnId)) {
    throw ApiError.notFound('Return not found.', 'RETURN_NOT_FOUND');
  }
  const returnRequest = await Return.findOne({ _id: returnId, warehouseId }).select(
    'orderId pharmacyId items notes images status rejectionNote creditSyp creditUsd creditEntryId creditValuation resolvedAt createdAt'
  );
  if (!returnRequest) {
    throw ApiError.notFound('Return not found.', 'RETURN_NOT_FOUND');
  }
  return returnRequest;
}

// Read-only detail - reuses the same attachOrderContext (order/item snapshots)
// and pharmacy lookup as listReturnsForWarehouse above.
async function getReturnDetailForWarehouse(returnId, warehouseId) {
  const returnRequest = await findOwnReturnOrThrow(returnId, warehouseId);

  const [contextRows, pharmacy] = await Promise.all([
    attachOrderContext([returnRequest]),
    Pharmacy.findById(returnRequest.pharmacyId).select('nameAr nameEn phone'),
  ]);
  const { order, orderItemById } = contextRows[0];

  return { returnRequest, order, orderItemById, pharmacy };
}

// What approving this return would credit, WITHOUT approving it - so the
// warehouse sees the number and the working before it commits. Read-only:
// creates nothing, moves nothing.
async function previewReturnCredit(returnId, warehouseId) {
  const returnRequest = await findOwnReturnOrThrow(returnId, warehouseId);
  // An already-decided return reports what it actually credited rather than a
  // fresh hypothetical.
  if (returnRequest.status !== 'pending') {
    return {
      returnRequest,
      creditSyp: returnRequest.creditSyp,
      creditUsd: returnRequest.creditUsd,
      breakdown: returnRequest.creditValuation,
      alreadyResolved: true,
    };
  }
  const valuation = await valueReturn(returnRequest);
  return { returnRequest, ...valuation, alreadyResolved: false };
}

// Money-Flow V2. Approving a return CREDITS the pharmacy's account - there is
// exactly one financial outcome, and no replacement order.
//
// The whole thing is one transaction: the status change, the credit entry, the
// balance movement and the audit record land together or not at all. The
// status move is a compare-and-swap, so two operators approving the same
// return at the same moment produce one credit and one clean conflict - V1
// produced two replacement orders, one of them orphaned.
async function approveReturn(returnId, warehouseId, userId) {
  const returnRequest = await loadPendingReturnOrThrow(returnId, warehouseId);

  const valuation = await valueReturn(returnRequest);
  // Resolved before the transaction opens - see ledger.service.js on upserts
  // and lazy index builds inside transactions.
  const account = await ledger.resolveAccount(returnRequest.pharmacyId, warehouseId);
  const now = new Date();

  const result = await runInTransaction(async (session) => {
    const claimed = await Return.findOneAndUpdate(
      { _id: returnRequest._id, warehouseId, status: 'pending' },
      {
        $set: {
          status: 'approved',
          resolvedBy: userId,
          resolvedAt: now,
          creditSyp: valuation.creditSyp,
          creditUsd: valuation.creditUsd,
          creditValuation: valuation.breakdown,
        },
      },
      { new: true, session }
    );
    if (!claimed) {
      throw ApiError.conflict(
        'This return has already been decided by someone else.',
        'RETURN_ALREADY_RESOLVED'
      );
    }

    const { entry } = await ledger.postEntry(
      {
        account,
        kind: 'return_credit',
        amountSyp: valuation.creditSyp,
        amountUsd: valuation.creditUsd,
        // The ORDER's frozen rate, carried through the valuation - a credit
        // undoes a specific historical charge, so it speaks that charge's
        // currency terms rather than today's.
        fx: { rate: valuation.breakdown.fxRate, source: 'order', rateAsOf: null },
        effectiveAt: now,
        source: { returnId: claimed._id },
        createdBy: userId,
        // orderId lives in metadata (not source) because `source.orderId` is
        // uniquely indexed for charges - one charge per order. The invoice
        // view reads credits back through this key.
        metadata: { orderId: returnRequest.orderId, ...valuation.breakdown },
      },
      session
    );

    // Saved on the document itself rather than through a separate updateOne,
    // so the object handed back to the caller carries the link too - a bare
    // updateOne would leave `claimed` stale in memory.
    claimed.creditEntryId = entry._id;
    await claimed.save({ session });

    await financialAudit.record(
      {
        action: 'return.approved',
        actorId: userId,
        actorRole: 'warehouse',
        entityType: 'Return',
        entityId: claimed._id,
        accountId: account._id,
        ledgerEntryIds: [entry._id],
        before: { status: 'pending' },
        after: { status: 'approved', creditSyp: valuation.creditSyp },
      },
      session
    );

    return { returnRequest: claimed, entry };
  });

  // Post-commit, best-effort: a realtime emit may never undo a credit that has
  // already been posted.
  emitToWarehouse(warehouseId, EVENTS.RETURN_STATUS_UPDATED, {
    returnId: result.returnRequest._id.toString(),
    orderId: result.returnRequest.orderId.toString(),
    warehouseId: String(warehouseId),
    status: 'approved',
  });

  return { returnRequest: result.returnRequest, creditEntry: result.entry };
}

async function rejectReturn(returnId, warehouseId, userId, rejectionNote) {
  const returnRequest = await loadPendingReturnOrThrow(returnId, warehouseId);

  const trimmedNote = typeof rejectionNote === 'string' ? rejectionNote.trim() : '';
  if (!trimmedNote) {
    throw ApiError.badRequest(
      'Please explain why this return is being rejected.',
      undefined,
      'REJECTION_NOTE_REQUIRED'
    );
  }

  const now = new Date();
  // Same compare-and-swap as approval: a rejection racing an approval must not
  // be able to overwrite a decision that has already moved money.
  const claimed = await Return.findOneAndUpdate(
    { _id: returnRequest._id, warehouseId, status: 'pending' },
    { $set: { status: 'rejected', rejectionNote: trimmedNote, resolvedBy: userId, resolvedAt: now } },
    { new: true }
  );
  if (!claimed) {
    throw ApiError.conflict(
      'This return has already been decided by someone else.',
      'RETURN_ALREADY_RESOLVED'
    );
  }

  // A rejection moves no money, so there is no ledger entry - but it is still
  // a discretionary financial decision with a mandatory reason, so it is audited.
  await financialAudit.record({
    action: 'return.rejected',
    actorId: userId,
    actorRole: 'warehouse',
    entityType: 'Return',
    entityId: claimed._id,
    before: { status: 'pending' },
    after: { status: 'rejected' },
    reason: trimmedNote,
  });

  emitToWarehouse(warehouseId, EVENTS.RETURN_STATUS_UPDATED, {
    returnId: claimed._id.toString(),
    orderId: claimed.orderId.toString(),
    warehouseId: String(warehouseId),
    status: 'rejected',
  });

  return claimed;
}

module.exports = {
  listReturnsForWarehouse,
  listPaginatedReturnsForWarehouse,
  approveReturn,
  rejectReturn,
  getReturnDetailForWarehouse,
  previewReturnCredit,
};
