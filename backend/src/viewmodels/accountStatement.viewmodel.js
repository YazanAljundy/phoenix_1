// Money-Flow V2. The account statement and the balance summaries built on it.
//
// Every figure is SYP - the settlement currency - and every one is a frozen
// per-entry amount, never a live re-conversion. USD rides along as a hint that
// is equally frozen, so a rate change moves neither.

// One statement line: date, what happened, what it refers to, and the running
// balance after it. Debit and credit are separate columns because that is how
// a statement reads; the caller never has to interpret a sign.
function serializeRow(row) {
  return {
    id: row.id,
    entryNumber: row.entryNumber,
    kind: row.kind,
    effectiveAt: row.effectiveAt,
    debitSyp: row.debitSyp,
    creditSyp: row.creditSyp,
    amountUsd: row.amountUsd,
    balanceSyp: row.balanceSyp,
    balanceUsd: row.balanceUsd,
    // Present on manual adjustments and every reversal, where it is mandatory.
    reason: row.reason,
    reversalOf: row.reversalOf,
    reference: row.reference,
  };
}

function party(doc) {
  if (!doc) return null;
  return { id: doc._id, nameAr: doc.nameAr, nameEn: doc.nameEn, phone: doc.phone };
}

// `viewerRole` picks which side's own identity to omit: a warehouse looking at
// this already knows which warehouse it is - it needs the pharmacy back, and
// vice versa. Same convention V1's toBalanceDetailResponse used.
function toStatementResponse(
  { pharmacy, warehouse, period, opening, closing, rows, summary },
  viewerRole
) {
  return {
    statement: {
      period,
      opening,
      closing,
      summary,
      // Named so the sign convention is never ambiguous: positive means the
      // pharmacy owes, negative means it is in credit.
      outstandingDebtSyp: Math.max(0, closing.syp),
      creditBalanceSyp: Math.max(0, -closing.syp),
      pharmacy: viewerRole === 'warehouse' ? party(pharmacy) : undefined,
      warehouse: viewerRole === 'pharmacy' ? party(warehouse) : undefined,
      rows: rows.map(serializeRow),
    },
  };
}

// The pharmacy's own "who do I owe" screen. All three headline figures are
// computed server-side - V1 summed balances in the client, in two different
// files, and silently dropped every credit.
function toPharmacyAccountsResponse({ totals, rows }) {
  return {
    totalDebtSyp: totals.totalDebtSyp,
    totalCreditSyp: totals.totalCreditSyp,
    netPositionSyp: totals.netPositionSyp,
    accounts: rows.map((row) => ({
      accountId: row.accountId,
      warehouseId: row.warehouseId,
      nameAr: row.warehouse.nameAr,
      nameEn: row.warehouse.nameEn,
      phone: row.warehouse.phone,
      balanceSyp: row.balanceSyp,
      balanceUsd: row.balanceUsd,
      outstandingDebtSyp: Math.max(0, row.balanceSyp),
      creditBalanceSyp: Math.max(0, -row.balanceSyp),
      lastActivityAt: row.lastActivityAt,
    })),
  };
}

// The warehouse's "Invoices" list - one row per pharmacy it trades with.
function toWarehouseAccountsResponse({ rows }) {
  return {
    pharmacies: rows.map((row) => ({
      accountId: row.accountId,
      pharmacyId: row.pharmacyId,
      nameAr: row.pharmacy.nameAr,
      nameEn: row.pharmacy.nameEn,
      phone: row.pharmacy.phone,
      balanceSyp: row.balanceSyp,
      balanceUsd: row.balanceUsd,
      outstandingDebtSyp: Math.max(0, row.balanceSyp),
      creditBalanceSyp: Math.max(0, -row.balanceSyp),
      lastActivityAt: row.lastActivityAt,
    })),
  };
}

module.exports = {
  toStatementResponse,
  toPharmacyAccountsResponse,
  toWarehouseAccountsResponse,
};
