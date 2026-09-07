const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Payment = require('../models/payment.model');
const Pharmacy = require('../models/pharmacy.model');
const Counter = require('../models/counter.model');
const LedgerEntry = require('../models/ledgerEntry.model');
const { runInTransaction } = require('../utils/transaction');
const ledger = require('./ledger.service');
const financialAudit = require('./financialAudit.service');
const { captureFxSnapshot } = require('./exchangeRate.service');

// Money-Flow V2. A payment is APPEND-ONLY.
//
// V1 let a warehouse edit or hard-delete any of its payments at any age, with
// no trail: a mistyped figure could be silently rewritten, and deleting one
// pushed the pharmacy's debt back up with nothing to show it had ever existed.
// That is the highest-value manipulation surface in a cash marketplace.
//
// Here a payment is a claim that money changed hands on a date. Right or
// wrong, that claim is a historical fact other people have already acted on
// (the pharmacy saw its balance drop). So it is never edited and never
// deleted - a mistake is corrected by posting a REVERSAL that references the
// original and carries a mandatory reason, leaving the whole narrative intact.
//
// The balance a payment moves lives entirely in the ledger: the transaction
// below posts the entry and updates the account's cache together, so there is
// nothing else to keep in step afterwards.

const CURRENCIES = ['USD', 'SYP'];
// SYP is Phoenix's default currency - a request that omits `currency`
// entirely records a Syrian-pound payment. An explicitly wrong value (e.g.
// 'EUR') is still rejected.
const DEFAULT_CURRENCY = 'SYP';
const METHODS = ['cash', 'bank_transfer', 'cheque', 'other'];
const DEFAULT_METHOD = 'cash';
const PAYMENT_NUMBER_COUNTER_ID = 'payment_number';

function validateAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('Invalid payment amount.', undefined, 'INVALID_PAYMENT_AMOUNT');
  }
}

function resolveCurrency(currency) {
  if (currency === undefined || currency === null) return DEFAULT_CURRENCY;
  if (!CURRENCIES.includes(currency)) {
    throw ApiError.badRequest('Invalid currency.', undefined, 'INVALID_PAYMENT_CURRENCY');
  }
  return currency;
}

function resolveMethod(method) {
  if (method === undefined || method === null) return DEFAULT_METHOD;
  if (!METHODS.includes(method)) {
    throw ApiError.badRequest('Invalid payment method.', undefined, 'INVALID_PAYMENT_METHOD');
  }
  return method;
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireReason(reason, code = 'REASON_REQUIRED') {
  const trimmed = normalizeText(reason);
  if (!trimmed) {
    throw ApiError.badRequest('A reason is required for this operation.', undefined, code);
  }
  return trimmed;
}

function resolvePaidAt(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest('Invalid payment date.', undefined, 'INVALID_PAYMENT_DATE');
  }
  // Money cannot have been received in the future. A minute of slack absorbs
  // clock skew between the operator's browser and the server.
  if (date.getTime() > Date.now() + 60 * 1000) {
    throw ApiError.badRequest(
      'A payment cannot be dated in the future.',
      undefined,
      'PAYMENT_DATE_IN_FUTURE'
    );
  }
  return date;
}

async function validatePharmacyId(pharmacyId) {
  if (typeof pharmacyId !== 'string' || !mongoose.Types.ObjectId.isValid(pharmacyId)) {
    throw ApiError.badRequest('Invalid pharmacy.', undefined, 'INVALID_PHARMACY');
  }
  const exists = await Pharmacy.exists({ _id: pharmacyId });
  if (!exists) {
    throw ApiError.badRequest('Invalid pharmacy.', undefined, 'INVALID_PHARMACY');
  }
}

// V1 accepted a payment against ANY pharmacy that merely existed, so a
// warehouse could write into the financial record of a pharmacy it had never
// traded with. V2 requires a real relationship - at least one delivered order
// on this account - unless the operator explicitly overrides it, which needs a
// reason and is audited.
async function assertTradingRelationship(accountId, { allowUnlinked, reason }) {
  const hasCharge = accountId ? await LedgerEntry.exists({ accountId, kind: 'charge' }) : null;
  if (hasCharge) return { unlinked: false, reason: null };

  if (!allowUnlinked) {
    throw ApiError.badRequest(
      'This pharmacy has no delivered orders from your warehouse yet.',
      undefined,
      'NO_TRADING_RELATIONSHIP'
    );
  }
  return { unlinked: true, reason: requireReason(reason, 'UNLINKED_PAYMENT_REASON_REQUIRED') };
}

async function nextPaymentNumber(session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: PAYMENT_NUMBER_COUNTER_ID },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );
  return counter.seq;
}

// Freezes the settled value in BOTH currencies at record time.
//
//   SYP tender -> amountSyp is exact; amountUsd is the conversion
//   USD tender -> amountUsd is exact; amountSyp is the conversion
//
// amountSyp is the figure that hits the ledger. Freezing it is precisely what
// stops a later exchange-rate move from re-floating an already-settled debt.
function freezeAmounts(amount, currency, fx) {
  const rate = fx?.rate ?? null;
  if (currency === 'USD') {
    return {
      amountUsd: Math.round(amount * 100) / 100,
      amountSyp: rate ? Math.round(amount * rate) : null,
    };
  }
  return {
    amountSyp: Math.round(amount),
    amountUsd: rate ? Math.round((amount / rate) * 100) / 100 : null,
  };
}

// IDOR guard: scoped to warehouseId, same pattern as every other
// warehouse-owned resource in this codebase - a warehouse can never touch
// another warehouse's payment.
async function findOwnedPaymentOrThrow(id, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.notFound('Payment not found.', 'PAYMENT_NOT_FOUND');
  }
  const payment = await Payment.findOne({ _id: id, warehouseId });
  if (!payment) {
    throw ApiError.notFound('Payment not found.', 'PAYMENT_NOT_FOUND');
  }
  return payment;
}

// $locals is Mongoose's per-document scratch space: never persisted, never
// serialized - it marks a response as an idempotent replay for the controller
// without adding a field to the schema.
async function findByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  const existing = await Payment.findOne({ idempotencyKey });
  if (existing) existing.$locals.idempotentReplay = true;
  return existing;
}

// Records money received. One transaction: the Payment, its ledger entry, the
// balance movement and the audit record all land together or not at all.
async function createPayment(warehouseId, recordedByUserId, data) {
  await validatePharmacyId(data.pharmacyId);
  validateAmount(data.amount);
  const currency = resolveCurrency(data.currency);
  const method = resolveMethod(data.method);
  const paidAt = resolvePaidAt(data.paidAt);
  const idempotencyKey = normalizeText(data.idempotencyKey);

  // Cheap path for the common retry; the unique index below is what actually
  // makes a concurrent retry safe.
  const replay = await findByIdempotencyKey(idempotencyKey);
  if (replay) return replay;

  // Resolved before the transaction opens - see ledger.service.js's note on
  // upserts and lazy index builds inside transactions.
  const account = await ledger.resolveAccount(data.pharmacyId, warehouseId);
  const relationship = await assertTradingRelationship(account._id, {
    allowUnlinked: data.allowUnlinked === true,
    reason: data.unlinkedReason,
  });

  const fx = await captureFxSnapshot();
  const frozen = freezeAmounts(data.amount, currency, fx);
  if (frozen.amountSyp === null) {
    throw ApiError.badRequest(
      'Exchange rate is not available yet - payments cannot be recorded.',
      undefined,
      'EXCHANGE_RATE_UNAVAILABLE'
    );
  }

  try {
    return await runInTransaction(async (session) => {
      const paymentNumber = await nextPaymentNumber(session);

      const [payment] = await Payment.create(
        [
          {
            pharmacyId: data.pharmacyId,
            warehouseId,
            accountId: account._id,
            paymentNumber,
            kind: 'settlement',
            status: 'posted',
            amount: data.amount,
            currency,
            amountSyp: frozen.amountSyp,
            amountUsd: frozen.amountUsd,
            fx: fx ?? undefined,
            method,
            reference: normalizeText(data.reference),
            paidAt,
            note: normalizeText(data.note),
            recordedBy: recordedByUserId,
            idempotencyKey,
          },
        ],
        { session }
      );

      const { entry } = await ledger.postEntry(
        {
          account,
          kind: 'payment',
          amountSyp: payment.amountSyp,
          amountUsd: payment.amountUsd,
          fx,
          // The date the money moved, not the date it was typed in - so a
          // backdated payment lands on the statement where it belongs.
          effectiveAt: paidAt,
          source: { paymentId: payment._id },
          createdBy: recordedByUserId,
          idempotencyKey,
          metadata: {
            paymentNumber,
            method,
            tenderAmount: data.amount,
            tenderCurrency: currency,
            unlinked: relationship.unlinked,
          },
        },
        session
      );

      payment.ledgerEntryId = entry._id;
      await payment.save({ session });

      await financialAudit.record(
        {
          action: 'payment.recorded',
          actorId: recordedByUserId,
          actorRole: 'warehouse',
          entityType: 'Payment',
          entityId: payment._id,
          accountId: account._id,
          ledgerEntryIds: [entry._id],
          after: {
            paymentNumber,
            amountSyp: payment.amountSyp,
            currency,
            method,
            unlinked: relationship.unlinked,
          },
          reason: relationship.reason,
          idempotencyKey,
        },
        session
      );

      return payment;
    });
  } catch (err) {
    // Two concurrent retries both pass the pre-check above; the loser lands
    // here on the unique idempotencyKey index. Return what the winner created.
    if (err && err.code === 11000 && idempotencyKey) {
      const existing = await findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }
}

// Undoes a payment without erasing it.
//
//   PAY-50  settlement  500,000  ->  status: reversed
//   PAY-71  reversal    500,000      reversesPaymentId: PAY-50, reason: "..."
//
// Both stay in the history and both appear on the statement, so the mistake
// and its correction are visible rather than airbrushed out. The reversal
// copies the ORIGINAL frozen amounts and rate, so reverse-then-re-record is
// exactly FX-neutral.
async function reversePayment(id, warehouseId, actorUserId, { reason, idempotencyKey } = {}) {
  const trimmedReason = requireReason(reason);
  const key = normalizeText(idempotencyKey);

  const replay = await findByIdempotencyKey(key);
  if (replay) return replay;

  const original = await findOwnedPaymentOrThrow(id, warehouseId);
  if (original.kind === 'reversal') {
    throw ApiError.badRequest(
      'A reversal cannot itself be reversed.',
      undefined,
      'CANNOT_REVERSE_A_REVERSAL'
    );
  }
  if (!original.ledgerEntryId) {
    // A row migrated from V1 that never produced a ledger entry. Reversing it
    // would move a balance nothing else explains, so it is refused explicitly
    // rather than half-handled.
    throw ApiError.badRequest(
      'This payment predates the ledger and cannot be reversed automatically.',
      undefined,
      'PAYMENT_NOT_LEDGERED'
    );
  }

  try {
    return await runInTransaction(async (session) => {
      // Compare-and-swap on the status: two operators reversing the same
      // payment at once means the second matches zero documents and gets a
      // clean conflict rather than a second reversal entry.
      const claimed = await Payment.findOneAndUpdate(
        { _id: original._id, warehouseId, status: 'posted' },
        { $set: { status: 'reversed', reversalReason: trimmedReason } },
        { new: true, session }
      );
      if (!claimed) {
        throw ApiError.conflict(
          'This payment has already been reversed.',
          'PAYMENT_ALREADY_REVERSED'
        );
      }

      const paymentNumber = await nextPaymentNumber(session);
      const [reversal] = await Payment.create(
        [
          {
            pharmacyId: claimed.pharmacyId,
            warehouseId,
            accountId: claimed.accountId,
            paymentNumber,
            kind: 'reversal',
            status: 'posted',
            // The same magnitude as the original - the sign lives on the
            // ledger entry's direction, so no money field here is ever negative.
            amount: claimed.amount,
            currency: claimed.currency,
            amountSyp: claimed.amountSyp,
            amountUsd: claimed.amountUsd,
            // The ORIGINAL rate, deliberately: a reversal must undo exactly
            // what was done, not what the same lira is worth today.
            fx: claimed.fx,
            method: claimed.method,
            reference: claimed.reference,
            paidAt: new Date(),
            recordedBy: actorUserId,
            reversesPaymentId: claimed._id,
            reversalReason: trimmedReason,
            idempotencyKey: key,
          },
        ],
        { session }
      );

      const targetEntry = await LedgerEntry.findById(claimed.ledgerEntryId).session(session);
      const { entry } = await ledger.postReversal(
        {
          targetEntry,
          createdBy: actorUserId,
          reason: trimmedReason,
          idempotencyKey: key,
          source: { paymentId: reversal._id },
        },
        session
      );

      reversal.ledgerEntryId = entry._id;
      await reversal.save({ session });

      await Payment.updateOne(
        { _id: claimed._id },
        { $set: { reversedByPaymentId: reversal._id } },
        { session }
      );

      await financialAudit.record(
        {
          action: 'payment.reversed',
          actorId: actorUserId,
          actorRole: 'warehouse',
          entityType: 'Payment',
          entityId: claimed._id,
          accountId: claimed.accountId,
          ledgerEntryIds: [entry._id],
          before: { status: 'posted', amountSyp: claimed.amountSyp },
          after: { status: 'reversed', reversalPaymentNumber: paymentNumber },
          reason: trimmedReason,
          idempotencyKey: key,
        },
        session
      );

      return reversal;
    });
  } catch (err) {
    if (err && err.code === 11000 && key) {
      const existing = await findByIdempotencyKey(key);
      if (existing) return existing;
    }
    throw err;
  }
}

// Every payment on an account, newest first - settlements and reversals alike,
// each carrying its own status, so the detail view shows the correction as
// well as the mistake.
async function listPaymentsForAccount(accountId) {
  return Payment.find({ accountId }).sort({ paidAt: -1, _id: -1 }).lean();
}

module.exports = {
  createPayment,
  reversePayment,
  listPaymentsForAccount,
  findOwnedPaymentOrThrow,
  freezeAmounts,
  METHODS,
};
