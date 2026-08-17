function serializeOrder(order) {
  return {
    id: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalPrice: order.totalPrice,
    discountAmount: order.discountAmount,
    commissionAmount: order.commissionAmount,
    finalPrice: order.finalPrice,
    notes: order.notes,
    warehouseId: order.warehouseId,
  };
}

function toOrderResponse(order) {
  return { order: serializeOrder(order) };
}

// Section 6.7/6.8: the tracking screen needs the warehouse name (for display
// context) and the full statusHistory (every change's recorded time); the
// digital invoice needs the full line items. Both are served from this one
// detail response rather than two separate endpoints for the same order.
// (commissionAmount still rides along via serializeOrder below - it's the
// Flutter invoice widget's job to not render a platform-internal figure on a
// pharmacy-facing receipt, not this endpoint's job to strip it.)
// Section 6.9: `returnRequest` (if any) is the order's linked return - shown
// as a compact status summary here, not the full items/photos (that's the
// returns feature's own detail, fetched separately if the pharmacist opens it).
function serializeLinkedReturn(returnRequest) {
  if (!returnRequest) return null;
  return {
    id: returnRequest._id,
    status: returnRequest.status,
    rejectionNote: returnRequest.rejectionNote,
    replacementOrderId: returnRequest.replacementOrderId,
  };
}

// Section 8/13c: the pharmacy's own rating of the warehouse for this order,
// if submitted - just enough for the tracking screen to show "already
// rated" and skip the form, not the full review list shape used elsewhere.
function serializeMyReview(review) {
  if (!review) return null;
  return {
    id: review._id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
  };
}

function toOrderDetailResponse(order, warehouse, items = [], returnRequest = null, myReview = null) {
  return {
    order: {
      ...serializeOrder(order),
      cancelReason: order.cancelReason,
      warehouseNameAr: warehouse.nameAr,
      warehouseNameEn: warehouse.nameEn,
      statusHistory: (order.statusHistory || []).map((entry) => ({
        status: entry.status,
        changedAt: entry.changedAt,
      })),
      createdAt: order.createdAt,
      items: items.map((item) => ({
        id: item._id,
        productId: item.productId,
        productNameAr: item.productNameAr,
        productNameEn: item.productNameEn,
        manufacturerAr: item.manufacturerAr,
        manufacturerEn: item.manufacturerEn,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPrice: item.discountPrice,
        lineTotal: item.discountPrice * item.quantity,
      })),
      linkedReturn: serializeLinkedReturn(returnRequest),
      myReview: serializeMyReview(myReview),
    },
  };
}

// Section 6.8: list summaries skip the heavier per-order lookups (no items,
// no full statusHistory - the full detail above is fetched on demand when
// the pharmacist opens one) but still carry the same pricing fields as
// serializeOrder, so the Flutter client can parse both responses through one
// OrderModel instead of two slightly-different shapes.
function toOrderListItemSummary(order, warehouse) {
  return {
    id: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalPrice: order.totalPrice,
    discountAmount: order.discountAmount,
    commissionAmount: order.commissionAmount,
    finalPrice: order.finalPrice,
    warehouseNameAr: warehouse ? warehouse.nameAr : null,
    warehouseNameEn: warehouse ? warehouse.nameEn : null,
    createdAt: order.createdAt,
  };
}

function toOrderListResponse(items) {
  return { orders: items.map(({ order, warehouse }) => toOrderListItemSummary(order, warehouse)) };
}

module.exports = { toOrderResponse, toOrderDetailResponse, toOrderListResponse };
