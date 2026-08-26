import http from 'k6/http';
import { check } from 'k6';
import { authParams, baseUrl, responseJson } from '../config.js';
import { recordStatus } from './metrics.js';

export function orders(token) {
  const response = http.get(`${baseUrl}/orders?limit=15`, {
    ...authParams(token), tags: { endpoint: 'orders_list' },
  });
  recordStatus(response, 'orders_list');
  check(response, { 'orders list returns 200': (item) => item.status === 200 });
  const body = responseJson(response);
  const first = body && Array.isArray(body.orders) ? body.orders[0] : null;
  if (first && first.id) {
    const detail = http.get(`${baseUrl}/orders/${first.id}`, {
      ...authParams(token), tags: { endpoint: 'order_detail' },
    });
    recordStatus(detail, 'order_detail');
  }
}
