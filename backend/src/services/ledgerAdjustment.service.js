const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const LedgerEntry = require('../models/ledgerEntry.model');
const Pharmacy = require('../models/pharmacy.model');
const Warehouse = require('../models/warehouse.model');
const { runInTransaction } = require('../utils/transaction');
const ledger = require('./ledger.service');
const financialAudit = require('./financialAudit.service');
const { captureFxSnapshot } = require('./exchangeRate.service');

// Money-Flow V2. Manual credits and debits - the escape hatch for the things
// no automated path covers: goodwill after a dispute, a correction to a
// delivered order that must not be re-priced, a write-off.
//
// ADMIN ONLY, deliberately. A warehouse can already move a balance through the
// paths that model real events (delivering, recording a payment, crediting a
// return); an arbitrary "make this number different" is a different kind of
// power and is kept with the platform, where it is always attributable.
//
// Every adjustment carries a MANDATORY reason - enforced twice, here and in
// ledger.postEntry's REASON_REQUIRED_KINDS - because an unexplained balance
// movement is exactly the thing V1's audit had no answer for.

const DIRECTIONS = { credit: 'manual_credit', debit: 'manual_debit' };

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validateAmount(amountSyp) {
  if (typeof amountSyp !== 'number' || !Number.isFinite(amountSyp) || amountSyp <= 0) {
    throw ApiError.badRequest(
      'Invalid adjustment amount.',
      undefined,
      'INVALID_ADJUSTMENT_AMOUNT'
    );
  }
  // Whole lira only - the ledger's exact-integer balance depends on it.
  return Math.round(amountSyp);
}

function resolveKind(direction) {
  const kind = DIRECTIONS[direction];
  if (!kind) {
    throw ApiError.badRequest(
      "Direction must be 'credit' or 'debit'.",
      undefined,
      'INVALID_ADJUSTMENT_DIRECTION'
    );
  }
  return kind;
}

async function validateParties(pharmacyId, warehouseId) {
  if (
    !mongoose.Types.ObjectId.isValid(pharmacyId) ||
    !mongoose.Types.ObjectId.isValid(warehouseId)
  ) {
    throw ApiError.badRequest('Invalid account.', undefined, 'INVALID_ACCOUNT');
  }
  const [pharmacy, warehouse] = await Promise.all([
    Pharmacy.exists({ _id: pharmacyId }),
    Warehouse.exists({ _id: warehouseId }),
  ]);
  if (!pharmacy || !warehouse) {
    throw ApiError.notFound('Account not found.', 'ACCOUNT_NOT_FOUND');
  }
}

async function findByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  return LedgerEntry.findOne({ idempotencyKey }).lean();
}

// Posts one manual credit or debit against a (pharmacy, warehouse) account.
async function postAdjustment({
  pharmacyId,
  warehouseId,
  direction,
  amountSyp,
  reason,
  actorId,
  idempotencyKey,
}) {
  const kind = resolveKind(direction);
  const amount = validateAmount(amountSyp);
  const trimmedReason = normalizeText(reason);
  if (!trimmedReason) {
    throw ApiError.badRequest(
      'A reason is required for a manual adjustment.',
      undefined,
      'REASON_REQUIRED'
    );
  }
  const key = normalizeText(idempotencyKey);

  await validateParties(pharmacyId, warehouseId);

  const replay = await findByIdempotencyKey(key);
  if (replay) return { entry: replay, replayed: true };

  // Resolved before the transaction opens - see ledger.service.js on upserts
  // and lazy index builds inside transactions.
  const account = await ledger.resolveAccount(pharmacyId, warehouseId);
  // An adjustment is stated in SYP (the settlement currency); the rate is
  // captured only so the USD reporting projection has a provenance, exactly
  // like every other entry.
  const fx = await captureFxSnapshot();

  try {
    const entry = await runInTransaction(async (session) => {
      const { entry: posted } = await ledger.postEntry(
        {
          account,
          kind,
          amountSyp: amount,
          amountUsd: fx?.rate ? Math.round((amount / fx.rate) * 100) / 100 : null,
          fx,
          source: {},
          createdBy: actorId,
          reason: trimmedReason,
          idempotencyKey: key,
        },
        session
      );

      await financialAudit.record(
        {
          action: kind === 'manual_credit' ? 'ledger.manual_credit' : 'ledger.manual_debit',
          actorId,
          actorRole: 'admin',
          entityType: 'LedgerEntry',
          entityId: posted._id,
          accountId: account._id,
          ledgerEntryIds: [posted._id],
          after: { kind, amountSyp: amount },
          reason: trimmedReason,
          idempotencyKey: key,
        },
        session
      );

      return posted;
    });

    return { entry, replayed: false };
  } catch (err) {
    if (err && err.code === 11000 && key) {
      const existing = await findByIdempotencyKey(key);
      if (existing) return { entry: existing, replayed: true };
    }
    throw err;
  }
}

// Undoes an adjustment that should not have been made. Like every reversal in
// V2 it is a NEW entry pointing back at the original - the mistake stays on
// the statement beside its correction rather than being erased.
async function reverseAdjustment({ entryId, reason, actorId, idempotencyKey }) {
  const trimmedReason = normalizeText(reason);
  if (!trimmedReason) {
    throw ApiError.badRequest(
      'A reason is required to reverse an adjustment.',
      undefined,
      'REASON_REQUIRED'
    );
  }
  if (!mongoose.Types.ObjectId.isValid(entryId)) {
    throw ApiError.notFound('Ledger entry not found.', 'LEDGER_ENTRY_NOT_FOUND');
  }
  const key = normalizeText(idempotencyKey);

  const replay = await findByIdempotencyKey(key);
  if (replay) return { entry: replay, replayed: true };

  const target = await LedgerEntry.findById(entryId);
  if (!target) {
    throw ApiError.notFound('Ledger entry not found.', 'LEDGER_ENTRY_NOT_FOUND');
  }
  // Only manual adjustments are reversible here. A charge is undone by
  // reversing the delivery, a payment by reversing the payment - each through
  // the path that owns it, so the linked document's status stays truthful.
  if (target.kind !== 'manual_credit' && target.kind !== 'manual_debit') {
    throw ApiError.badRequest(
      'Only a manual adjustment can be reversed here.',
      undefined,
      'NOT_A_MANUAL_ADJUSTMENT'
    );
  }

  try {
    const entry = await runInTransaction(async (session) => {
      const { entry: posted } = await ledger.postReversal(
        { targetEntry: target, createdBy: actorId, reason: trimmedReason, idempotencyKey: key },
        session
      );

      await financialAudit.record(
        {
          action: 'ledger.adjustment_reversed',
          actorId,
          actorRole: 'admin',
          entityType: 'LedgerEntry',
          entityId: target._id,
          accountId: target.accountId,
          ledgerEntryIds: [posted._id],
          before: { kind: target.kind, amountSyp: target.amountSyp },
          after: { reversedBy: posted._id },
          reason: trimmedReason,
          idempotencyKey: key,
        },
        session
      );

      return posted;
    });

    return { entry, replayed: false };
  } catch (err) {
    if (err && err.code === 11000 && key) {
      const existing = await findByIdempotencyKey(key);
      if (existing) return { entry: existing, replayed: true };
    }
    throw err;
  }
}

// Forces a full replay of an account's ledger into its balance cache. The
// operational counterpart to the nightly verifier: if that ever reports a
// mismatch, this is how an admin fixes it deliberately, with an audit record.
async function rebuildAccountBalance({ accountId, actorId, reason }) {
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    throw ApiError.notFound('Account not found.', 'ACCOUNT_NOT_FOUND');
  }
  const before = await ledger.verifyAccount(accountId);
  const replay = await ledger.replayAccount(accountId, { persist: true });

  await financialAudit.record({
    action: 'balance.rebuilt',
    actorId,
    actorRole: 'admin',
    entityType: 'LedgerAccount',
    entityId: accountId,
    accountId,
    before: before.cache ?? null,
    after: { syp: replay.syp, usd: replay.usd, lastEntrySeq: replay.lastEntrySeq },
    reason: normalizeText(reason),
  });

  return { wasConsistent: before.ok, balance: replay };
}

module.exports = { postAdjustment, reverseAdjustment, rebuildAccountBalance };
