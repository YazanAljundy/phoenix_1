const { serializePayment } = require('./payment.viewmodel');

// Section 16: the warehouse's "who owes me" list - one row per debtor. The
// web table also wants the two running totals, not just the net balance -
// both already sit on the cached balance doc, so no extra query needed.
function serializeDebtorRow({ balance, pharmacy }) {
  return {
    pharmacyId: pharmacy._id,
    nameAr: pharmacy.nameAr,
    nameEn: pharmacy.nameEn,
    phone: pharmacy.phone,
    totalOrdersUsd: balance.totalOrdersUsd,
    totalPaidUsd: balance.totalPaidUsd,
    balanceUsd: balance.balanceUsd,
  };
}

function toDebtorListResponse(rows) {
  return { pharmacies: rows.map(serializeDebtorRow) };
}

// The pharmacist's mirror of the above - one row per warehouse they owe.
function serializeDebtRow({ balance, warehouse }) {
  return {
    warehouseId: warehouse._id,
    nameAr: warehouse.nameAr,
    nameEn: warehouse.nameEn,
    phone: warehouse.phone,
    totalOrdersUsd: balance.totalOrdersUsd,
    totalPaidUsd: balance.totalPaidUsd,
    balanceUsd: balance.balanceUsd,
  };
}

function toDebtListResponse(rows) {
  return { warehouses: rows.map(serializeDebtRow) };
}

// Shared by both the warehouse's own detail view (with edit/delete affordances,
// gated client-side on each payment's own `canEdit`) and the pharmacist's
// read-only one - same shape either way, the pharmacist's client just never
// renders the edit/delete actions. `viewerRole` picks which side's own
// identity to omit (a warehouse viewing this already knows which pharmacy
// it clicked into - it needs the pharmacy's info back; the pharmacist needs
// the warehouse's).
function toBalanceDetailResponse({ balance, orders, payments, pharmacy, warehouse }, viewerRole) {
  return {
    balanceUsd: balance.balanceUsd,
    totalOrdersUsd: balance.totalOrdersUsd,
    totalPaidUsd: balance.totalPaidUsd,
    lastUpdated: balance.lastUpdated,
    pharmacy:
      viewerRole === 'warehouse'
        ? { id: pharmacy._id, nameAr: pharmacy.nameAr, nameEn: pharmacy.nameEn, phone: pharmacy.phone }
        : undefined,
    warehouse:
      viewerRole === 'pharmacy'
        ? { id: warehouse._id, nameAr: warehouse.nameAr, nameEn: warehouse.nameEn, phone: warehouse.phone }
        : undefined,
    orders: orders.map((order) => ({
      id: order._id,
      orderNumber: order.orderNumber,
      finalPrice: order.finalPrice,
      createdAt: order.createdAt,
    })),
    payments: payments.map(serializePayment),
  };
}

module.exports = {
  toDebtorListResponse,
  toDebtListResponse,
  toBalanceDetailResponse,
};
