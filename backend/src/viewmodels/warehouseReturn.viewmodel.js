const { serializeReturn } = require('./return.viewmodel');

function serializeWarehouseReturn({ returnRequest, order, orderItemById, pharmacy }) {
  return {
    ...serializeReturn(returnRequest, orderItemById),
    orderNumber: order ? order.orderNumber : null,
    pharmacyNameAr: pharmacy ? pharmacy.nameAr : null,
    pharmacyNameEn: pharmacy ? pharmacy.nameEn : null,
    pharmacyPhone: pharmacy ? pharmacy.phone : null,
  };
}

function toWarehouseReturnsResponse(rows) {
  return { returns: rows.map(serializeWarehouseReturn) };
}

// Same shape as the list row, plus the replacement order's number (only
// meaningful once approved) - the returns list intentionally skips this
// since it's the detail page's job (per the request), not a queue column.
function toWarehouseReturnDetailResponse({ returnRequest, order, orderItemById, pharmacy, replacementOrder }) {
  return {
    return: {
      ...serializeWarehouseReturn({ returnRequest, order, orderItemById, pharmacy }),
      replacementOrderNumber: replacementOrder ? replacementOrder.orderNumber : null,
    },
  };
}

function toResolvedReturnResponse(returnRequest, replacementOrder) {
  return {
    return: {
      id: returnRequest._id,
      status: returnRequest.status,
      rejectionNote: returnRequest.rejectionNote,
      replacementOrderId: returnRequest.replacementOrderId,
      resolvedAt: returnRequest.resolvedAt,
    },
    replacementOrder: replacementOrder
      ? { id: replacementOrder._id, orderNumber: replacementOrder.orderNumber }
      : null,
  };
}

module.exports = { toWarehouseReturnsResponse, toResolvedReturnResponse, toWarehouseReturnDetailResponse };
