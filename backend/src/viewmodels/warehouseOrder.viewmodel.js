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

function toWarehouseOrderStatusResponse(order) {
  return {
    order: {
      id: order._id,
      status: order.status,
      statusHistory: (order.statusHistory || []).map((entry) => ({
        status: entry.status,
        changedAt: entry.changedAt,
      })),
    },
  };
}

module.exports = { toWarehouseOrdersResponse, toWarehouseOrderStatusResponse };
