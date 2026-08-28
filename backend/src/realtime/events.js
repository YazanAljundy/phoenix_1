// The realtime layer's public vocabulary, in one place so the backend
// emitters and the React dashboard can never drift on a string literal.
//
// Every event is a *signal*, not a payload: it says "this entity changed",
// carries only the ids needed to identify it, and the dashboard then reads
// the authoritative state back through the existing HTTP API. See
// realtime/index.js for why.
const EVENTS = {
  ORDER_CREATED: 'order.created',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_STATUS_UPDATED: 'order.status.updated',
  RETURN_CREATED: 'return.created', 
  RETURN_STATUS_UPDATED: 'return.status.updated',
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

module.exports = { EVENTS, warehouseRoom };
