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
  ACCOUNT_PENDING: 'account.pending',
  ACCOUNT_STATUS_UPDATED: 'account.status.updated',
  OFFER_PENDING: 'offer.pending',
  OFFER_STATUS_UPDATED: 'offer.status.updated',
  BANNER_PENDING: 'banner.pending',
  BANNER_STATUS_UPDATED: 'banner.status.updated',
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
