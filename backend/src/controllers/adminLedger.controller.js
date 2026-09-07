const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const adjustmentService = require('../services/ledgerAdjustment.service');
const statementService = require('../services/accountStatement.service');
const statementViewModel = require('../viewmodels/accountStatement.viewmodel');

// Money-Flow V2. The platform's own financial controls.
//
// Admin-only by the router-level authorize('admin'): a warehouse can already
// move a balance through the paths that model real events, but an arbitrary
// adjustment is a different kind of power and stays with the platform, where
// it is always attributable to a named person with a stated reason.

function parseIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) {
    throw ApiError.badRequest('Invalid idempotency key.', undefined, 'INVALID_IDEMPOTENCY_KEY');
  }
  return value;
}

function serializeEntry(entry) {
  return {
    id: entry._id,
    entryNumber: entry.entryNumber,
    accountId: entry.accountId,
    kind: entry.kind,
    direction: entry.direction,
    amountSyp: entry.amountSyp,
    amountUsd: entry.amountUsd ?? null,
    reason: entry.reason ?? null,
    reversalOf: entry.reversalOf ?? null,
    effectiveAt: entry.effectiveAt,
  };
}

function respond(res, { entry, replayed }, message) {
  if (replayed) res.set('Idempotent-Replay', 'true');
  res.status(replayed ? 200 : 201).json({
    success: true,
    message,
    entry: serializeEntry(entry),
  });
}

// A manual credit or debit against one (pharmacy, warehouse) account.
const createAdjustment = asyncHandler(async (req, res) => {
  const result = await adjustmentService.postAdjustment({
    pharmacyId: req.body.pharmacyId,
    warehouseId: req.body.warehouseId,
    direction: req.body.direction,
    amountSyp: req.body.amountSyp,
    reason: req.body.reason,
    actorId: req.user._id,
    idempotencyKey: parseIdempotencyKey(req.body.idempotencyKey),
  });
  respond(res, result, 'Adjustment posted.');
});

// Undoes an adjustment by posting its reversal - the original stays on the
// statement beside the correction.
const reverseAdjustment = asyncHandler(async (req, res) => {
  const result = await adjustmentService.reverseAdjustment({
    entryId: req.params.entryId,
    reason: req.body.reason,
    actorId: req.user._id,
    idempotencyKey: parseIdempotencyKey(req.body.idempotencyKey),
  });
  respond(res, result, 'Adjustment reversed.');
});

// Forces a full replay of an account's ledger into its balance cache - the
// operational fix if the nightly verifier ever reports a mismatch.
const rebuildBalance = asyncHandler(async (req, res) => {
  const result = await adjustmentService.rebuildAccountBalance({
    accountId: req.params.accountId,
    actorId: req.user._id,
    reason: req.body?.reason,
  });
  res.json({ success: true, ...result });
});

// Any account's statement, for support and dispute handling.
const statement = asyncHandler(async (req, res) => {
  const data = await statementService.getStatement({
    pharmacyId: req.params.pharmacyId,
    warehouseId: req.params.warehouseId,
    from: req.query.from,
    to: req.query.to,
  });
  res.json({ success: true, ...statementViewModel.toStatementResponse(data, 'admin') });
});

module.exports = { createAdjustment, reverseAdjustment, rebuildBalance, statement };
