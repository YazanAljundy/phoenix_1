const { serializePharmacy } = require('./auth.viewmodel');

function serializeOrderItem(item) {
  return {
    id: item._id,
    productId: item.productId,
    productNameAr: item.productNameAr,
    productNameEn: item.productNameEn,
    manufacturerAr: item.manufacturerAr,
    manufacturerEn: item.manufacturerEn,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discountPrice: item.discountPrice,
  };
}

// Section 13b: the warehouse needs the full item list (to know what to
// prepare) and the pharmacy's contact info (who it's for, where it goes) -
// unlike the pharmacist's own list, which never needs to see itself.
function toWarehouseOrderItem({ order, items, pharmacy, hasReviewed }) {
  return {
    id: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    finalPrice: order.finalPrice,
    notes: order.notes,
    createdAt: order.createdAt,
    pharmacy: serializePharmacy(pharmacy),
    items: items.map(serializeOrderItem),
    hasReviewed: Boolean(hasReviewed),
  };
}

function toWarehouseOrdersResponse(rows) {
  return { orders: rows.map(toWarehouseOrderItem) };
}

// Section 13b: the order-detail read view (WarehouseOrderDetail) - the full
// set of existing order fields, not the trimmed list-item shape above.
// `hasReturn` is deliberately just a boolean (a badge, per the request) -
// the return's own detail is that feature's own page, not this one's job.
function toWarehouseOrderDetailResponse({ order, items, pharmacy, hasReturn }) {
  return {
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalPrice: order.totalPrice,
      discountAmount: order.discountAmount,
      commissionAmount: order.commissionAmount,
      finalPrice: order.finalPrice,
      notes: order.notes,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt,
      statusHistory: (order.statusHistory || []).map((entry) => ({
        status: entry.status,
        changedAt: entry.changedAt,
        note: entry.note ?? null,
      })),
      pharmacy: serializePharmacy(pharmacy),
      items: items.map((item) => ({
        ...serializeOrderItem(item),
        lineTotal: item.discountPrice * item.quantity,
        savingsUsd: item.savingsUsd,
      })),
      hasReturn: Boolean(hasReturn),
    },
  };
}

function toWarehouseOrderStatusResponse(order) {
  return {
    order: {
      id: order._id,
      status: order.status,
      statusHistory: (order.statusHistory || []).map((entry) => ({
        status: entry.status,
        changedAt: entry.changedAt,
        note: entry.note ?? null,
      })),
    },
  };
}

module.exports = { toWarehouseOrdersResponse, toWarehouseOrderDetailResponse, toWarehouseOrderStatusResponse };
