// Money-Flow V2. The warehouse's settlement report: what it sold, what came
// back, what the platform is owed, and what it keeps.
//
// Every figure is SYP - the settlement currency - and every one of them is a
// sum of frozen per-order values, never a live re-conversion. The vocabulary
// is kept strictly separate: SALES is what pharmacies were charged, not what
// was collected in cash (that is the account balance's job); COMMISSION is
// what the platform is owed, not a discount; NET is what the warehouse keeps.
function serializeSettlementRow(row) {
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    invoiceNumber: row.invoiceNumber,
    deliveredAt: row.deliveredAt,
    subtotalSyp: row.subtotalSyp,
    platformDiscountSyp: row.platformDiscountSyp,
    advertisementDiscountSyp: row.advertisementDiscountSyp,
    salesSyp: row.salesSyp,
    commissionSyp: row.commissionSyp,
    creditedSyp: row.creditedSyp,
    commissionClawbackSyp: row.commissionClawbackSyp,
    warehouseNetSyp: row.warehouseNetSyp,
  };
}

function toSettlementResponse({ period, totals, rows }) {
  return {
    settlement: {
      period,
      totals,
      orders: rows.map(serializeSettlementRow),
    },
  };
}

module.exports = { toSettlementResponse, serializeSettlementRow };
