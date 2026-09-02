import http from 'k6/http';
import { baseUrl, params, record, json, catalogWarehouse, warehouseIdentity } from '../lib/runtime.js';

// Read-only warehouse detail as a *pharmacist* sees it (Section 17's "about
// this warehouse" screen). getWarehouseProfile also loads every visible review
// for the warehouse, so this call grows with review count, not just with load.
export function readWarehouse(token) {
  const warehouse = catalogWarehouse();
  const profile = http.get(
    baseUrl + '/warehouses/' + warehouse.id + '/profile',
    params(token, 'warehouse_profile')
  );
  record(profile, 'warehouse_profile');

  const manufacturers = http.get(
    baseUrl + '/warehouses/' + warehouse.id + '/manufacturers',
    params(token, 'warehouse_manufacturers')
  );
  record(manufacturers, 'warehouse_manufacturers');
}

// The React warehouse panel's own polling load, driven by a warehouse-role
// token. Included because the panel is the other live consumer of this
// backend and shares its CPU and connection pool with the mobile traffic -
// and because it is the same population that holds the Socket.IO connections.
export function warehousePanel() {
  const account = warehouseIdentity();
  const orders = http.get(
    baseUrl + '/warehouse/orders?limit=15',
    params(account.token, 'warehouse_orders_list')
  );
  record(orders, 'warehouse_orders_list');
  return json(orders);
}
