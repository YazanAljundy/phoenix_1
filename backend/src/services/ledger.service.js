const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const LedgerAccount = require('../models/ledgerAccount.model');
const LedgerEntry = require('../models/ledgerEntry.model');
const Counter = require('../models/counter.model');

const { ENTRY_KINDS, DEBIT, CREDIT } = LedgerEntry;

// Money-Flow V2 core. The ONLY module that writes a LedgerEntry or moves a
// LedgerAccount balance. Everything else - deliveries, payments, returns,
// adjustments - describes what happened and hands it to postEntry.
//
// Invariants this file exists to hold:
//   * an entry is written once and never updated or deleted
//   * `sequence` is monotonic and gap-free per account
//   * balanceCache is moved in the SAME atomic update that issues the sequence
//   * balanceCache always equals a full replay (replayAccount / verifyAccount)

const ENTRY_NUMBER_COUNTER_ID = 'ledger_entry_number';

// A reason is not optional on anything a human chose to do to someone else's
// balance. Enforced here so no caller can forget.
const REASON_REQUIRED_KINDS = new Set([
  'charge_reversal',
  'payment_reversal',
  'return_credit_reversal',
  'manual_credit',
  'manual_debit',
  'adjustment_reversal',
  'migration_adjustment',
]);

// Kinds whose direction depends on what they are reversing / reconciling, so
// the caller must state it explicitly.
const DIRECTION_REQUIRED_KINDS = new Set([
  'adjustment_reversal',
  'migration_adjustment',
  'opening_balance',
]);

function round2(amount) {
  return Math.round(amount * 100) / 100;
}

// SYP is the authoritative side and is always whole lira, so the balance is an
// exact integer sum. USD is a reporting projection built from each entry's own
// frozen 2dp figure - rounded wherever it is read rather than trusted
// bit-exact, since float addition is not associative.
function signOf(direction) {
  return direction === DEBIT ? 1 : -1;
}

function signedSyp(entry) {
  return entry.amountSyp * signOf(entry.direction);
}

function signedUsd(entry) {
  return (entry.amountUsd ?? 0) * signOf(entry.direction);
}

function resolveDirection(kind, explicit) {
  const fixed = ENTRY_KINDS[kind];
  if (fixed) return fixed;
  if (!DIRECTION_REQUIRED_KINDS.has(kind)) {
    throw new Error(`Unknown ledger entry kind: ${kind}`);
  }
  if (explicit !== DEBIT && explicit !== CREDIT) {
    throw new Error(`Kind '${kind}' requires an explicit direction.`);
  }
  return explicit;
}

// Find-or-create the account for a (pharmacy, warehouse) pair. Safe to call
// concurrently: the upsert is atomic and the pair is uniquely indexed, so a
// race ends with one document either way.
async function resolveAccount(pharmacyId, warehouseId, session = null) {
  const filter = { pharmacyId, warehouseId };
  return LedgerAccount.findOneAndUpdate(
    filter,
    { $setOnInsert: { ...filter, settlementCurrency: 'SYP' } },
    { upsert: true, new: true, session }
  );
}

// Read-only: the account as it stands, or null. Never creates a row - the
// warehouse "invoices" list and the pharmacy debts list both need to render a
// pharmacy that has no account document yet as a plain zero.
async function findAccount(pharmacyId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(pharmacyId) || !mongoose.Types.ObjectId.isValid(warehouseId)) {
    return null;
  }
  return LedgerAccount.findOne({ pharmacyId, warehouseId });
}

async function nextEntryNumber(session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: ENTRY_NUMBER_COUNTER_ID },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );
  return counter.seq;
}

// THE write path.
//
// Must be called inside a transaction (`session` required): the sequence
// reservation, the balance movement and the entry insert have to be one
// all-or-nothing step, or a crash between them leaves a gap in the sequence or
// a balance that no entry explains.
async function postEntry(
  {
    account,
    kind,
    direction: explicitDirection,
    amountSyp,
    amountUsd = null,
    fx = null,
    effectiveAt = null,
    source = {},
    reversalOf = null,
    createdBy = null,
    reason = null,
    idempotencyKey = null,
    metadata = null,
  },
  session
) {
  if (!session) {
    throw new Error('postEntry requires a transaction session.');
  }

  const direction = resolveDirection(kind, explicitDirection);

  if (!Number.isFinite(amountSyp) || amountSyp < 0) {
    throw ApiError.badRequest('Invalid ledger amount.', undefined, 'INVALID_LEDGER_AMOUNT');
  }
  // Whole lira only - a fractional SYP amount would break the exact-integer
  // guarantee the balance depends on.
  const roundedSyp = Math.round(amountSyp);
  const roundedUsd = amountUsd === null || amountUsd === undefined ? null : round2(amountUsd);

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (REASON_REQUIRED_KINDS.has(kind) && !trimmedReason) {
    throw ApiError.badRequest(
      'A reason is required for this financial operation.',
      undefined,
      'REASON_REQUIRED'
    );
  }

  // A reversal points at exactly one entry, that entry must not itself be a
  // reversal, and it must not already have been reversed. The unique partial
  // index on `reversalOf` is the hard guard against a race; this is the clear
  // error for the ordinary case.
  if (reversalOf) {
    const target = await LedgerEntry.findById(reversalOf).session(session);
    if (!target) {
      throw ApiError.notFound('The entry being reversed was not found.', 'LEDGER_ENTRY_NOT_FOUND');
    }
    if (target.reversalOf) {
      throw ApiError.badRequest(
        'A reversal entry cannot itself be reversed.',
        undefined,
        'CANNOT_REVERSE_A_REVERSAL'
      );
    }
    const already = await LedgerEntry.findOne({ reversalOf }).select('_id').session(session);
    if (already) {
      throw ApiError.conflict('This entry has already been reversed.', 'ALREADY_REVERSED');
    }
  }

  const accountId = account._id ?? account;
  const delta = roundedSyp * signOf(direction);
  const deltaUsd = (roundedUsd ?? 0) * signOf(direction);
  const now = new Date();
  const businessDate = effectiveAt ?? now;

  // One atomic update issues the sequence AND moves the balance. seqCounter
  // and balanceCache.lastEntrySeq move in lockstep by construction, so the
  // cache always names the highest sequence it has folded in.
  const update = {
    $inc: {
      seqCounter: 1,
      'balanceCache.syp': delta,
      'balanceCache.usd': deltaUsd,
      'balanceCache.lastEntrySeq': 1,
    },
    $set: { lastActivityAt: now },
  };
  if (kind === 'charge') {
    // $min leaves an earlier value alone, so this settles on the FIRST charge
    // even when a backdated one is posted later.
    update.$min = { firstChargeAt: businessDate };
  }

  const updatedAccount = await LedgerAccount.findOneAndUpdate({ _id: accountId }, update, {
    new: true,
    session,
  });
  if (!updatedAccount) {
    throw ApiError.notFound('Ledger account not found.', 'LEDGER_ACCOUNT_NOT_FOUND');
  }

  const entryNumber = await nextEntryNumber(session);

  const [entry] = await LedgerEntry.create(
    [
      {
        accountId: updatedAccount._id,
        pharmacyId: updatedAccount.pharmacyId,
        warehouseId: updatedAccount.warehouseId,
        sequence: updatedAccount.seqCounter,
        entryNumber,
        kind,
        direction,
        amountSyp: roundedSyp,
        amountUsd: roundedUsd,
        fx: fx
          ? {
              rate: fx.rate ?? null,
              source: fx.source ?? null,
              rateAsOf: fx.rateAsOf ?? null,
              estimated: Boolean(fx.estimated),
            }
          : undefined,
        postedAt: now,
        effectiveAt: businessDate,
        source: {
          orderId: source.orderId ?? null,
          paymentId: source.paymentId ?? null,
          returnId: source.returnId ?? null,
        },
        reversalOf: reversalOf ?? null,
        createdBy,
        reason: trimmedReason || null,
        idempotencyKey: idempotencyKey ?? null,
        metadata,
      },
    ],
    { session }
  );

  return { entry, account: updatedAccount };
}

// Which reversal kind undoes which forward kind.
function reversalKindFor(kind) {
  switch (kind) {
    case 'charge':
      return 'charge_reversal';
    case 'payment':
      return 'payment_reversal';
    case 'return_credit':
      return 'return_credit_reversal';
    case 'manual_credit':
    case 'manual_debit':
      return 'adjustment_reversal';
    default:
      throw ApiError.badRequest('This kind of entry cannot be reversed.', undefined, 'NOT_REVERSIBLE');
  }
}

// Builds the reversing counterpart of an existing entry: the exact same
// amounts (copied, NOT recomputed at today's rate, so a reverse-then-repost is
// FX-neutral) with the direction flipped.
async function postReversal({ targetEntry, createdBy, reason, idempotencyKey, source = {} }, session) {
  // Checked here as well as inside postEntry so the caller gets the precise
  // reason rather than the generic "this kind cannot be reversed" that
  // reversalKindFor would raise first for a *_reversal kind.
  if (targetEntry.reversalOf) {
    throw ApiError.badRequest(
      'A reversal entry cannot itself be reversed.',
      undefined,
      'CANNOT_REVERSE_A_REVERSAL'
    );
  }
  const kind = reversalKindFor(targetEntry.kind);
  const direction = targetEntry.direction === DEBIT ? CREDIT : DEBIT;

  return postEntry(
    {
      account: targetEntry.accountId,
      kind,
      direction,
      amountSyp: targetEntry.amountSyp,
      amountUsd: targetEntry.amountUsd,
      // The ORIGINAL rate, deliberately - a reversal must undo exactly what
      // was done, not what the same lira would be worth today.
      fx: targetEntry.fx,
      effectiveAt: new Date(),
      source: {
        orderId: source.orderId ?? targetEntry.source?.orderId ?? null,
        paymentId: source.paymentId ?? null,
        returnId: source.returnId ?? targetEntry.source?.returnId ?? null,
      },
      reversalOf: targetEntry._id,
      createdBy,
      reason,
      idempotencyKey,
      metadata: { reversedEntryNumber: targetEntry.entryNumber, reversedKind: targetEntry.kind },
    },
    session
  );
}

// A full scan of a busy account's entries takes long enough for a real
// postEntry to land mid-scan; each retry costs one more scan of the same
// account, so this is generous headroom rather than a tight budget.
const MAX_REPLAY_ATTEMPTS = 5;

// One replay attempt. `guardSeq` is the account's seqCounter as read right
// before the scan below started; persisting is conditioned on it still being
// that value, so a postEntry that lands during the scan - which is a plain
// read, not a snapshot, and can take a while on a busy account - can't have
// its contribution silently overwritten by a sum that was already stale by
// the time it finished. `persisted` tells the caller whether that guard held:
// null means there was nothing to guard (persist:false, or no such account),
// true means the write landed, false means seqCounter had already moved and
// nothing was written - the caller's job is to rescan, not reuse this sum.
async function replayAccountOnce(accountId, { persist, session }) {
  const account = persist
    ? await LedgerAccount.findById(accountId).select('seqCounter').session(session).lean()
    : null;

  let syp = 0;
  let usd = 0;
  let lastEntrySeq = 0;
  let count = 0;

  const cursor = LedgerEntry.find({ accountId })
    .select('sequence kind direction amountSyp amountUsd')
    .sort({ sequence: 1 })
    .lean()
    .cursor();

  for await (const entry of cursor) {
    syp += signedSyp(entry);
    usd += signedUsd(entry);
    lastEntrySeq = entry.sequence;
    count += 1;
  }

  const result = { syp: Math.round(syp), usd: round2(usd), lastEntrySeq, entryCount: count };

  if (!persist || !account) {
    // persist:false is a read-only comparison (verifyAccount); a missing
    // account has nothing to guard or write, same as today.
    return { result, persisted: null };
  }

  const update = await LedgerAccount.updateOne(
    { _id: accountId, seqCounter: account.seqCounter },
    {
      $set: {
        'balanceCache.syp': result.syp,
        'balanceCache.usd': result.usd,
        'balanceCache.lastEntrySeq': result.lastEntrySeq,
        'balanceCache.rebuiltAt': new Date(),
      },
    },
    { session }
  );

  return { result, persisted: update.matchedCount > 0 };
}

// Recomputes an account's balance from its entries, in sequence order. This is
// the DEFINITION of the balance; balanceCache is only ever "what this would
// return". Used by the verifier, the migration backfill and the admin rebuild
// action - never on the normal write path, which moves the cache incrementally.
async function replayAccount(accountId, { persist = true, session = null } = {}) {
  for (let attempt = 1; attempt <= MAX_REPLAY_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { result, persisted } = await replayAccountOnce(accountId, { persist, session });
    if (persisted !== false) return result;
    // seqCounter moved under us: something posted while this scan was
    // running. That sum is already missing whatever just landed, so it is
    // rescanned from scratch rather than retried as-is.
  }
  throw new Error(
    `replayAccount: gave up after ${MAX_REPLAY_ATTEMPTS} attempts - account ${accountId} kept being ` +
      'posted to faster than it could be replayed.'
  );
}

// Compares the cache against a replay without writing anything. A mismatch is
// always a bug - the caller logs it loudly and rebuilds.
async function verifyAccount(accountId) {
  const account = await LedgerAccount.findById(accountId).select('balanceCache seqCounter').lean();
  if (!account) return { ok: false, missing: true, accountId };

  const replay = await replayAccount(accountId, { persist: false });
  const cached = account.balanceCache ?? { syp: 0, usd: 0, lastEntrySeq: 0 };

  const ok =
    Math.round(cached.syp ?? 0) === replay.syp &&
    round2(cached.usd ?? 0) === replay.usd &&
    (cached.lastEntrySeq ?? 0) === replay.lastEntrySeq;

  return { ok, accountId, cached, replay };
}

// Sweeps every account. Returns the ones that did not verify, having rebuilt
// them. Wired to a scheduled job in server.js and to an admin endpoint.
async function verifyAllAccounts({ rebuild = true } = {}) {
  const mismatches = [];
  const cursor = LedgerAccount.find({}).select('_id').lean().cursor();

  for await (const { _id } of cursor) {
    const result = await verifyAccount(_id);
    if (!result.ok) {
      mismatches.push(result);
      if (rebuild) await replayAccount(_id, { persist: true });
    }
  }
  return mismatches;
}

// The statement read: every entry for an account in canonical order.
// effectiveAt (the business date) first, sequence to break ties - never
// wall-clock alone, so a backdated payment lands on the day the money actually
// moved without the ordering becoming ambiguous.
async function listEntriesForAccount(accountId, { from = null, to = null } = {}) {
  const filter = { accountId };
  if (from || to) {
    filter.effectiveAt = {};
    if (from) filter.effectiveAt.$gte = from;
    if (to) filter.effectiveAt.$lte = to;
  }
  return LedgerEntry.find(filter).sort({ effectiveAt: 1, sequence: 1 }).lean();
}

// The opening balance for a statement period: everything that happened before
// it. Summed from the entries themselves, so it always agrees with the rows
// the period then lists.
async function openingBalanceFor(accountId, from) {
  if (!from) return { syp: 0, usd: 0 };
  const [row] = await LedgerEntry.aggregate([
    {
      $match: {
        accountId: new mongoose.Types.ObjectId(String(accountId)),
        effectiveAt: { $lt: from },
      },
    },
    {
      $group: {
        _id: null,
        syp: {
          $sum: { $multiply: ['$amountSyp', { $cond: [{ $eq: ['$direction', DEBIT] }, 1, -1] }] },
        },
        usd: {
          $sum: {
            $multiply: [
              { $ifNull: ['$amountUsd', 0] },
              { $cond: [{ $eq: ['$direction', DEBIT] }, 1, -1] },
            ],
          },
        },
      },
    },
  ]);
  return { syp: Math.round(row?.syp ?? 0), usd: round2(row?.usd ?? 0) };
}

// Builds the financial collections' indexes up front, at boot.
//
// Mongoose creates indexes lazily in the background on first model use. If
// that build happens to start while a financial transaction is touching the
// same collection, the transaction sees a write conflict and gets retried -
// on a cold database that can burn the whole retry budget and surface as a
// spurious "concurrent activity" error on the very first delivery. Doing it
// once, deliberately, before any request is served removes that race, and the
// unique indexes (one charge per order, one reversal per entry) are load-
// bearing guarantees that should never be merely "probably built by now".
async function ensureFinancialIndexes() {
  await Promise.all([LedgerAccount.createIndexes(), LedgerEntry.createIndexes()]);
}

module.exports = {
  ensureFinancialIndexes,
  postEntry,
  postReversal,
  resolveAccount,
  findAccount,
  replayAccount,
  verifyAccount,
  verifyAllAccounts,
  listEntriesForAccount,
  openingBalanceFor,
  signedSyp,
  signedUsd,
  round2,
  reversalKindFor,
  DEBIT,
  CREDIT,
  REASON_REQUIRED_KINDS,
};
