function serializeReturnItem(item, orderItem) {
  return {
    orderItemId: item.orderItemId,
    productId: item.productId,
    quantity: item.quantity,
    reasonType: item.reasonType,
    customReason: item.customReason,
    productNameAr: orderItem ? orderItem.productNameAr : null,
    productNameEn: orderItem ? orderItem.productNameEn : null,
  };
}

function serializeReturn(returnRequest, orderItemById = new Map()) {
  return {
    id: returnRequest._id,
    orderId: returnRequest.orderId,
    items: returnRequest.items.map((item) =>
      serializeReturnItem(item, orderItemById.get(item.orderItemId.toString()))
    ),
    notes: returnRequest.notes,
    images: returnRequest.images,
    status: returnRequest.status,
    rejectionNote: returnRequest.rejectionNote,
    // Money-Flow V2: an approved return credits the pharmacy's account. There
    // is no replacement order any more, so no replacementOrderId - what the
    // client shows instead is what the return was worth.
    creditSyp: returnRequest.creditSyp ?? null,
    creditUsd: returnRequest.creditUsd ?? null,
    resolvedAt: returnRequest.resolvedAt,
    createdAt: returnRequest.createdAt,
  };
}

function toReturnResponse(returnRequest, orderItemById = new Map()) {
  return { return: serializeReturn(returnRequest, orderItemById) };
}

// Section 6.9: the list needs enough context to render without a follow-up
// fetch - which order (its number) this return is for, and each item's
// snapshotted product name, joined in by return.service.js's
// listReturnsForPharmacy/attachOrderContext.
function toReturnListItemSummary(returnRequest, order, orderItemById) {
  return {
    ...serializeReturn(returnRequest, orderItemById),
    orderNumber: order ? order.orderNumber : null,
  };
}

function toReturnListResponse(items) {
  return {
    returns: items.map(({ returnRequest, order, orderItemById }) =>
      toReturnListItemSummary(returnRequest, order, orderItemById)
    ),
  };
}

module.exports = { toReturnResponse, toReturnListResponse, serializeReturn };
