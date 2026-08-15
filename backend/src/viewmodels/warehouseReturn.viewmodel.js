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

module.exports = { toWarehouseReturnsResponse, toResolvedReturnResponse };
