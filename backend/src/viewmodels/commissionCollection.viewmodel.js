// The admin's cross-warehouse commission view.
//
// Every figure is SYP - the settlement currency - and a sum of frozen
// per-order values, never a live re-conversion. The vocabulary is kept
// strictly separate, same as the warehouse's own Settlement tab:
//
//   SALES        what pharmacies were charged for delivered orders
//   RETURNS      credited back against those orders
//   OWED         commission the platform is due, after the pro-rata clawback
//   COLLECTED    what the warehouse has actually handed over for this range
//   OUTSTANDING  owed - collected

const { paginationMeta } = require('../utils/pagination');

function serializeWarehouseRow(row) {
  return {
    warehouseId: row.warehouseId,
    nameAr: row.warehouse.nameAr,
    nameEn: row.warehouse.nameEn,
    phone: row.warehouse.phone ?? null,
    isActive: row.warehouse.isActive ?? true,
    orderCount: row.orderCount,
    salesSyp: row.salesSyp,
    returnsSyp: row.returnsSyp,
    commissionOwedSyp: row.commissionOwedSyp,
    alreadyCollectedSyp: row.alreadyCollectedSyp,
    outstandingSyp: row.outstandingSyp,
  };
}

// A reversed collection keeps its place in the history, struck through with
// the reason that undid it - the same treatment a reversed pharmacy payment
// gets, so the two read alike.
function serializeCollection(collection) {
  return {
    id: collection._id,
    warehouseId: collection.warehouseId,
    periodFrom: collection.periodFrom,
    periodTo: collection.periodTo,
    amountSyp: collection.amountSyp,
    method: collection.method,
    reference: collection.reference ?? null,
    note: collection.note ?? null,
    recordedBy: collection.recordedBy,
    recordedAt: collection.recordedAt,
    status: collection.status,
    reversedAt: collection.reversedAt ?? null,
    reversalReason: collection.reversalReason ?? null,
  };
}

function toOverviewResponse({ period, totals, rows }) {
  return {
    overview: {
      period,
      totals,
      warehouses: rows.map(serializeWarehouseRow),
    },
  };
}

// One warehouse: its own figures, the per-order breakdown behind them, and
// every collection ever recorded against it.
function toWarehouseDetailResponse({
  period,
  warehouse,
  summary,
  orders,
  collections,
  hasMoreCollections,
  nextCollectionsCursor,
}) {
  return {
    detail: {
      period,
      warehouse: {
        id: warehouse._id,
        nameAr: warehouse.nameAr,
        nameEn: warehouse.nameEn,
        phone: warehouse.phone ?? null,
      },
      summary: serializeWarehouseRow(summary),
      orders: orders.map((order) => ({
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        invoiceNumber: order.invoiceNumber,
        deliveredAt: order.deliveredAt,
        salesSyp: order.salesSyp,
        creditedSyp: order.creditedSyp,
        commissionSyp: order.commissionSyp,
        commissionClawbackSyp: order.commissionClawbackSyp,
        netCommissionSyp: order.netCommissionSyp,
      })),
      collections: collections.map(serializeCollection),
      pagination: paginationMeta(hasMoreCollections, nextCollectionsCursor),
    },
  };
}

function toCollectionResponse(collection) {
  return { collection: serializeCollection(collection) };
}

module.exports = {
  toOverviewResponse,
  toWarehouseDetailResponse,
  toCollectionResponse,
  serializeCollection,
  serializeWarehouseRow,
};
