const FinancialAuditLog = require('../models/financialAuditLog.model');

// Money-Flow V2. The single writer for the financial audit trail.
//
// Deliberately exposes only `record` and read helpers: there is no update and
// no delete, so "append-only" is a property of the module's surface rather
// than a convention someone has to remember.
//
// Every financial mutation writes one of these. The reason field is mandatory
// for the destructive/discretionary actions listed in REASON_REQUIRED - the
// callers validate it too (ledger.service.js does the same for entry kinds),
// but this is the last line of defence before it reaches the database.
const REASON_REQUIRED = new Set([
  'payment.reversed',
  'ledger.manual_credit',
  'ledger.manual_debit',
  'ledger.adjustment_reversed',
  'order.charge_reversed',
  'return.rejected',
  'commission.collection_reversed',
]);

// Written inside the same transaction as the financial effect it describes, so
// an audited action is either fully recorded or did not happen. `session` is
// therefore required on the write paths; the migration/backfill passes null
// deliberately (it runs outside a per-account transaction).
async function record(
  {
    action,
    actorId = null,
    actorRole = null,
    onBehalfOfWarehouseId = null,
    entityType = null,
    entityId = null,
    accountId = null,
    ledgerEntryIds = [],
    before = null,
    after = null,
    reason = null,
    requestId = null,
    idempotencyKey = null,
    at = null,
  },
  session = null
) {
  const trimmedReason = typeof reason === 'string' ? reason.trim() : null;
  if (REASON_REQUIRED.has(action) && !trimmedReason) {
    // A programming error, not a user error - the callers validate first and
    // return a clean 400. Reaching here means a caller forgot.
    throw new Error(`Financial audit action '${action}' requires a reason.`);
  }

  const doc = {
    at: at ?? new Date(),
    action,
    actorId,
    actorRole,
    onBehalfOfWarehouseId,
    entityType,
    entityId,
    accountId,
    ledgerEntryIds,
    before,
    after,
    reason: trimmedReason,
    requestId,
    idempotencyKey,
  };

  const [written] = await FinancialAuditLog.create([doc], session ? { session } : {});
  return written;
}

// Read side - used by the admin investigation view and by tests asserting that
// a mutation left a trail.
async function listForAccount(accountId, { limit = 100 } = {}) {
  return FinancialAuditLog.find({ accountId }).sort({ at: -1 }).limit(limit).lean();
}

async function listForEntity(entityType, entityId, { limit = 50 } = {}) {
  return FinancialAuditLog.find({ entityType, entityId }).sort({ at: -1 }).limit(limit).lean();
}

module.exports = { record, listForAccount, listForEntity, REASON_REQUIRED };
