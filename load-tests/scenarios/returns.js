import http from 'k6/http';
import { baseUrl, params, record } from '../lib/runtime.js';

// Scenario E - returns.
//
// Read paths only in the main suite. POST /returns is multipart and its
// (optional) photos are streamed to Cloudinary by the controller before the
// return is even validated. Under load that is an external-service stress
// test aimed at a third party's account, not a test of Phoenix - so the
// upload path is measured on its own, at low concurrency, by upload-load.js.

export function returnsFlow(token) {
  const returnable = http.get(baseUrl + '/orders/returnable', params(token, 'orders_returnable'));
  record(returnable, 'orders_returnable');

  const list = http.get(baseUrl + '/returns?limit=15', params(token, 'returns_list'));
  record(list, 'returns_list');
}
