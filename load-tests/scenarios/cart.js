import http from 'k6/http';
import {
  baseUrl, params, record, json, orderProductIds, orderTargetWarehouseId,
} from '../lib/runtime.js';

// Scenario C - shopping.
//
// Phoenix has no cart API. The Flutter cart feature
// (lib/features/cart) holds the basket in client state and submits the whole
// thing as `items` on POST /orders, so "add to cart", "change quantity" and
// "remove item" produce no server traffic at all and cannot be load-tested as
// endpoints. What the server actually sees for a shopping session is:
// repeated catalog reads while the basket is assembled, then one order write.
// That is what this models, and the absence of a cart API is recorded in
// LOAD_TEST_GAPS.md rather than faked with a stand-in endpoint.

const enableWrites = __ENV.RUN_WRITE_SCENARIOS === 'true';

// Browsing while filling the basket: several product reads against the
// warehouse the order will be placed with.
export function assembleCart(token, reads) {
  const pages = reads || 3;
  let cursor = null;
  for (let i = 0; i < pages; i += 1) {
    const url = baseUrl + '/warehouses/' + orderTargetWarehouseId + '/products?limit=20' +
      (cursor ? '&after=' + encodeURIComponent(cursor) : '');
    const response = http.get(url, params(token, i === 0 ? 'products_list' : 'products_page2'));
    record(response, i === 0 ? 'products_list' : 'products_page2');
    const body = json(response);
    cursor = body && body.pagination ? body.pagination.nextCursor : null;
    if (!cursor) break;
  }
}

// Checkout. Guarded behind RUN_WRITE_SCENARIOS because it creates a real
// Order + OrderItem rows; every one it creates is tagged through the fixture
// warehouse and removed by `seed-load-data.js --clean`.
export function checkout(token, itemCount) {
  if (!enableWrites) return null;
  const count = itemCount || 3;
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const productId = orderProductIds[(__VU * 7 + __ITER * 3 + i) % orderProductIds.length];
    items.push({ productId, quantity: 1 + (i % 5) });
  }
  const response = http.post(
    baseUrl + '/orders',
    JSON.stringify({
      warehouseId: orderTargetWarehouseId,
      items,
      notes: '[LOADTEST] shopping scenario',
    }),
    params(token, 'orders_create')
  );
  record(response, 'orders_create');
  return json(response);
}

export function shoppingFlow(token) {
  assembleCart(token, 3);
  checkout(token, 3);
}
