import http from 'k6/http';
import { check } from 'k6';
import { authParams, baseUrl, selectedWarehouseId } from '../config.js';
import { recordStatus } from './metrics.js';

export function readWarehouse(token) {
  const params = authParams(token);
  const warehouseId = selectedWarehouseId();
  const profile = http.get(`${baseUrl}/warehouses/${warehouseId}/profile`, {
    ...params, tags: { endpoint: 'warehouse_profile' },
  });
  recordStatus(profile, 'warehouse_profile');
  check(profile, { 'warehouse profile returns 200': (item) => item.status === 200 });
  const manufacturers = http.get(`${baseUrl}/warehouses/${warehouseId}/manufacturers`, {
    ...params, tags: { endpoint: 'warehouse_manufacturers' },
  });
  recordStatus(manufacturers, 'warehouse_manufacturers');
  check(manufacturers, { 'manufacturers returns 200': (item) => item.status === 200 });
}
