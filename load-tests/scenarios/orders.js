import http from 'k6/http';
import { baseUrl, params, record, json, identity } from '../lib/runtime.js';

// Scenario D - order history. The app's "my orders" tab: the paginated list,
// then one order's detail (which is the invoice/tracking screen), then the
// returnable-orders query the returns tab opens with.
//
// Cancel is deliberately not exercised under load: it is a state transition
// that permanently changes a fixture order, so the write pool would be
// consumed within seconds and every later iteration would measure the
// ORDER_NOT_CANCELLABLE error path instead of the endpoint.

export function orderHistory(token) {
  const list = http.get(baseUrl + '/orders?limit=15', params(token, 'orders_list'));
  record(list, 'orders_list');

  const body = json(list);
  const orders = body && Array.isArray(body.orders) ? body.orders : [];
  if (orders.length > 0) {
    const target = orders[__ITER % orders.length];
    const id = target.id || target._id;
    if (id) {
      const detail = http.get(baseUrl + '/orders/' + id, params(token, 'order_detail'));
      record(detail, 'order_detail');
    }
  }
}

export function returnableOrders(token) {
  const response = http.get(baseUrl + '/orders/returnable', params(token, 'orders_returnable'));
  record(response, 'orders_returnable');
}

// Detail read straight from the fixture manifest rather than from a preceding
// list call - isolates GET /orders/:id from GET /orders in the per-endpoint
// table instead of always pricing them together.
export function orderDetailDirect(token) {
  const user = identity();
  if (!user.orderIds.length) return;
  const id = user.orderIds[__ITER % user.orderIds.length];
  const response = http.get(baseUrl + '/orders/' + id, params(token, 'order_detail'));
  record(response, 'order_detail');
}

export function orderFlow(token) {
  orderHistory(token);
  returnableOrders(token);
}
