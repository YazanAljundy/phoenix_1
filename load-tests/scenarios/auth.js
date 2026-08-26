import http from 'k6/http';
import { check } from 'k6';
import { authParams, baseUrl, responseJson, vuUser } from '../config.js';
import { recordStatus } from './metrics.js';

export function login() {
  const user = vuUser();
  const response = http.post(`${baseUrl}/auth/login-password`, JSON.stringify(user), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'auth_login_password' },
  });
  const body = responseJson(response);
  recordStatus(response, 'auth_login_password');
  check(response, { 'password login returns 200': (item) => item.status === 200 });
  return body && body.token ? body.token : null;
}

export function me(token) {
  const response = http.get(`${baseUrl}/auth/me`, { ...authParams(token), tags: { endpoint: 'auth_me' } });
  recordStatus(response, 'auth_me');
  check(response, { 'auth me returns 200': (item) => item.status === 200 });
  return response;
}
