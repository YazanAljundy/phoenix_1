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

// Same shape as the list row, plus the full credit working - the detail page
// is where an operator would want to see HOW the credited figure was reached,
// not just what it was.
function toWarehouseReturnDetailResponse({ returnRequest, order, orderItemById, pharmacy }) {
  return {
    return: {
      ...serializeWarehouseReturn({ returnRequest, order, orderItemById, pharmacy }),
      creditValuation: returnRequest.creditValuation ?? null,
    },
  };
}

// Money-Flow V2: approving a return credits the pharmacy's account. There is
// no replacement order any more, so the resolved response carries the credited
// amount and the ledger entry that moved it instead of a replacement order id.
function toResolvedReturnResponse(returnRequest, creditEntry = null) {
  return {
    return: {
      id: returnRequest._id,
      status: returnRequest.status,
      rejectionNote: returnRequest.rejectionNote,
      creditSyp: returnRequest.creditSyp ?? null,
      creditUsd: returnRequest.creditUsd ?? null,
      resolvedAt: returnRequest.resolvedAt,
    },
    creditEntry: creditEntry
      ? {
          id: creditEntry._id,
          entryNumber: creditEntry.entryNumber,
          amountSyp: creditEntry.amountSyp,
          amountUsd: creditEntry.amountUsd,
        }
      : null,
  };
}

// The read-only "what would this credit?" answer, so the warehouse sees the
// number and the working before it commits to approving.
function toReturnCreditPreviewResponse({ creditSyp, creditUsd, breakdown, alreadyResolved }) {
  return {
    preview: {
      creditSyp: creditSyp ?? null,
      creditUsd: creditUsd ?? null,
      alreadyResolved: Boolean(alreadyResolved),
      breakdown: breakdown ?? null,
    },
  };
}

module.exports = {
  toWarehouseReturnsResponse,
  toResolvedReturnResponse,
  toWarehouseReturnDetailResponse,
  toReturnCreditPreviewResponse,
};
