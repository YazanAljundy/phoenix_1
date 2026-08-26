import http from 'k6/http';
import { check } from 'k6';
import { authParams, baseUrl, enableMutations, selectedWarehouseId } from '../config.js';
import { recordStatus } from './metrics.js';

export function cart(token) {
  const params = authParams(token);
  const orders = http.get(`${baseUrl}/orders?limit=1`, { ...params, tags: { endpoint: 'orders_list_cart_read' } });
  recordStatus(orders, 'orders_list_cart_read');
  check(orders, { 'cart read proxy returns 200': (item) => item.status === 200 });

  if (!enableMutations) return;
  // Phoenix has no cart endpoint. Cart mutations are represented by order creation.
  // This path is intentionally opt-in and must target a disposable environment.
  const productId = __ENV.TEST_PRODUCT_ID;
  if (!productId) return;
  const createOrder = http.post(`${baseUrl}/orders`, JSON.stringify({
    warehouseId: selectedWarehouseId(),
    items: [{ productId, quantity: 1 }],
    notes: 'k6 load test',
  }), { ...params, tags: { endpoint: 'orders_create_mutation' } });
  recordStatus(createOrder, 'orders_create_mutation');
}
