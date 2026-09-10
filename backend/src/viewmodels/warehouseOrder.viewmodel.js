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
    // Which package this line belongs to, or null for an ordinary line. The
    // panel groups the lines by it and hides the per-line edit controls on
    // the ones that have it.
    packageGroupId: item.packageGroupId ?? null,
  };
}

// Prices cross the boundary in SYP here, like every other money field on the
// warehouse order shape: `totalPriceSyp` is the frozen package total for all
// copies, converted through the snapshot's OWN rate rather than today's, so
// the panel shows what the pharmacy actually owes for it.
function serializePackageGroups(order) {
  return (order.orderPackageGroups ?? []).map((group) => ({
    id: group._id,
    advertisementId: group.advertisementId,
    titleAr: group.advertisementSnapshot?.titleAr ?? null,
    titleEn: group.advertisementSnapshot?.titleEn ?? null,
    copies: group.copies,
    // Per copy, and for all copies - both in USD, as stored.
    unitPriceUsd: group.advertisementSnapshot?.totalPriceUsd ?? 0,
    totalPriceUsd: group.totalPriceUsd,
    totalPriceSyp: Math.round(
      (group.advertisementSnapshot?.totalPriceUsd ?? 0) *
        group.copies *
        (group.advertisementSnapshot?.usdToSyp ?? 0)
    ),
    // What one copy contains - the panel shows units as quantity x copies.
    items: (group.advertisementSnapshot?.items ?? []).map((item) => ({
      productId: item.productId,
      quantityPerCopy: item.quantity,
    })),
  }));
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
      // Its own line, never folded into discountAmount above - see
      // order.model.js. null/0 on a normal order.
      advertisementId: order.advertisementId ?? null,
      advertisementDiscountAmount: order.advertisementDiscountAmount ?? 0,
      // The packages on this order, each with the terms frozen at purchase.
      // The panel renders one card per group and marks its product lines
      // read-only - the API refuses to edit them either
      // (PACKAGE_ITEMS_LOCKED), so the two agree.
      packageGroups: serializePackageGroups(order),
      finalPrice: order.finalPrice,
      // Money-Flow V2: what the WAREHOUSE actually keeps on this order, once
      // the platform's commission comes off what the pharmacy pays. V1 stored
      // commissionAmount and showed it nowhere, so a warehouse could not see
      // what a package deal really netted it. Derived rather than stored -
      // it is a pure function of two frozen fields.
      warehouseNetSyp: order.finalPrice - order.commissionAmount,
      notes: order.notes,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt,
      statusHistory: (order.statusHistory || []).map((entry) => ({
        status: entry.status,
        changedAt: entry.changedAt,
        note: entry.note ?? null,
      })),
      // Section: optional delivery seal photo, decided per order.
      // `requiresDeliverySealPhoto` drives the per-order toggle + the "waiting
      // for the photo" hint next to the advance button; the other two are the
      // stored result, shown read-only.
      requiresDeliverySealPhoto: order.requiresDeliverySealPhoto ?? false,
      deliverySealPhoto: order.deliverySealPhoto ?? null,
      deliverySealConfirmedAt: order.deliverySealConfirmedAt ?? null,
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
