import http from 'k6/http';
import { baseUrl, params, record, json, identity, fixturePassword } from '../lib/runtime.js';

// Scenario A - authentication.
//
// Split in two on purpose:
//  - `me()` is the session-validation call the Flutter app makes on every
//    launch and is safe to run on every iteration.
//  - `fullLogin()` exercises POST /auth/login-password, which is bcrypt-bound
//    (cost 10) and sits behind authLimiter. It is deliberately a small slice
//    of the mix; running it on every iteration would turn the whole suite into
//    a bcrypt benchmark.

export function me(token) {
  const response = http.get(baseUrl + '/auth/me', params(token, 'auth_me'));
  record(response, 'auth_me');
  return response;
}

export function fullLogin(phone) {
  const response = http.post(
    baseUrl + '/auth/login-password',
    JSON.stringify({ phone, password: fixturePassword }),
    params(null, 'auth_login_password')
  );
  record(response, 'auth_login_password');
  const body = json(response);
  return body && body.token ? body.token : null;
}

// Scenario A end-to-end: log in, validate the session, list warehouses, then
// open the selected warehouse - the exact sequence the app performs between
// the login screen and the catalog.
export function authenticationFlow() {
  const user = identity();
  const token = fullLogin(user.phone) || user.token;
  me(token);
  const warehouses = http.get(baseUrl + '/warehouses', params(token, 'warehouses_list'));
  record(warehouses, 'warehouses_list');
  const body = json(warehouses);
  const list = body && Array.isArray(body.warehouses) ? body.warehouses : [];
  if (list.length === 0) return;
  const selected = list[0].id || list[0]._id;
  const manufacturers = http.get(
    baseUrl + '/warehouses/' + selected + '/manufacturers',
    params(token, 'warehouse_manufacturers')
  );
  record(manufacturers, 'warehouse_manufacturers');
}
