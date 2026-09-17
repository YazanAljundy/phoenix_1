// The realtime layer's public vocabulary, in one place so the backend
// emitters and the React dashboard can never drift on a string literal.
//
// Every event is a *signal*, not a payload: it says "this entity changed",
// carries only the ids needed to identify it, and the dashboard then reads
// the authoritative state back through the existing HTTP API. See
// realtime/index.js for why.
const EVENTS = {
  // Warehouse-room events: one order/return belongs to exactly one warehouse.
  ORDER_CREATED: 'order.created',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_STATUS_UPDATED: 'order.status.updated',
  RETURN_CREATED: 'return.created',
  RETURN_STATUS_UPDATED: 'return.status.updated',
  // A pharmacy rated the warehouse on a delivered order. Pharmacy->warehouse
  // reviews are visible immediately (review.service.js), so the warehouse's
  // Reviews page has a new row the moment this fires.
  REVIEW_CREATED: 'review.created',

  // Admin-room events. These mirror the three queues the admin panel actually
  // has a page for - accounts awaiting approval, offers awaiting moderation,
  // banners awaiting moderation - plus the decision that clears each one (so a
  // second admin's screen doesn't keep showing work that's already handled).
  //
  // Note what is deliberately NOT here: order/return events for admins. The
  // admin role has no orders or returns endpoint at all (see
  // routes/admin.routes.js), so there is nothing for such an event to refresh -
  // routing them to admins would push every warehouse's activity into a room
  // with no consumer.
  //
  // The three moderation STATUS_UPDATED events below (offer / banner /
  // advertisement) are ALSO sent to the owning warehouse's room when an admin
  // decides, edits or deletes that warehouse's item - the warehouse is the one
  // waiting on that decision (see adminOffer/adminBanner/adminAdvertisement
  // .service.js). A warehouse's own delete still goes to admins only, so it
  // never echoes back to the warehouse that made it.
  ACCOUNT_PENDING: 'account.pending',
  ACCOUNT_STATUS_UPDATED: 'account.status.updated',
  OFFER_PENDING: 'offer.pending',
  OFFER_STATUS_UPDATED: 'offer.status.updated',
  BANNER_PENDING: 'banner.pending',
  BANNER_STATUS_UPDATED: 'banner.status.updated',
  ADVERTISEMENT_PENDING: 'advertisement.pending',
  ADVERTISEMENT_STATUS_UPDATED: 'advertisement.status.updated',
  // A package paused or re-enabled. Its own event, not a STATUS_UPDATED,
  // because availability is a separate layer from moderation (see
  // advertisement.model.js's isAvailable). Sent to the admin room on every
  // change, and ALSO to the owning warehouse's room when an admin makes it -
  // that warehouse is the one waiting on an admin to re-enable its package.
  ADVERTISEMENT_AVAILABILITY_UPDATED: 'advertisement.availability.updated',

  // Complaint events. Unlike everything above, a complaint has TWO dashboards
  // that care: the admin queue that triages and answers it (admin room), and
  // the warehouse's own "complaints against me" list (that one warehouse's
  // room). So each of these is emitted to both - see complaint.service.js /
  // adminComplaint.service.js. Still id-only signals; each dashboard re-reads
  // the authoritative record over HTTP.
  COMPLAINT_CREATED: 'complaint.created',
  COMPLAINT_UPDATED: 'complaint.updated',
};

// One room per warehouse. The business rule is that an order/delivery belongs
// to exactly one warehouse (order.model.js's required `warehouseId`), so an
// order event has exactly one destination room - there is no fan-out across
// warehouses to get wrong.
//
// Room names are only ever built from a server-side value (the warehouse
// resolved from the authenticated user's own profile, or an order's stored
// warehouseId) - never from anything a client sent. See index.js.
function warehouseRoom(warehouseId) {
  return `warehouse:${String(warehouseId)}`;
}

// One shared room for every admin. Not `admin:<adminId>` - nothing an admin
// sees is scoped to that individual admin: the pending-accounts, offers and
// banners queues are global, and every admin is looking at the same list. A
// per-admin room would add a dimension the data model doesn't have.
//
// Membership is granted only by role === 'admin', resolved server-side. A
// warehouse user can never end up here (see resolveRoomsFor in index.js).
const ADMIN_ROOM = 'admin';

module.exports = { EVENTS, warehouseRoom, ADMIN_ROOM };
