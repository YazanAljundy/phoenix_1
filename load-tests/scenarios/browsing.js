import http from 'k6/http';
import { baseUrl, params, record, json, catalogWarehouse } from '../lib/runtime.js';

// Scenario B - browsing. Mirrors the Flutter app's actual catalog journey
// (warehouse_selection -> catalog): warehouses -> profile -> manufacturers ->
// products -> next page. The app also loads banners and the exchange rate on
// the home screen, so those ride along in the same session.

const PAGE_LIMIT = Number(__ENV.PAGE_LIMIT || 20);

export function homeScreen(token) {
  const banners = http.get(baseUrl + '/banners/active', params(token, 'banners_active'));
  record(banners, 'banners_active');
  const rate = http.get(baseUrl + '/exchange-rate', params(token, 'exchange_rate'));
  record(rate, 'exchange_rate');
}

export function browse(token) {
  const warehouse = catalogWarehouse();

  const warehouses = http.get(baseUrl + '/warehouses', params(token, 'warehouses_list'));
  record(warehouses, 'warehouses_list');

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

  const categories = http.get(baseUrl + '/categories', params(token, 'categories_list'));
  record(categories, 'categories_list');

  const products = http.get(
    baseUrl + '/warehouses/' + warehouse.id + '/products?limit=' + PAGE_LIMIT,
    params(token, 'products_list')
  );
  record(products, 'products_list');

  const body = json(products);
  const cursor = body && body.pagination ? body.pagination.nextCursor : null;
  if (cursor) {
    const page2 = http.get(
      baseUrl + '/warehouses/' + warehouse.id + '/products?limit=' + PAGE_LIMIT +
        '&after=' + encodeURIComponent(cursor),
      params(token, 'products_page2')
    );
    record(page2, 'products_page2');
  }
  return warehouse;
}

// Search is measured separately from paging because the two take completely
// different code paths in product.service.js: paging is a cursored, index-
// backed query, while search loads the warehouse's entire product set and
// filters it in memory.
export function search(token, term) {
  const warehouse = catalogWarehouse();
  const response = http.get(
    baseUrl + '/warehouses/' + warehouse.id + '/products?search=' + encodeURIComponent(term),
    params(token, 'products_search')
  );
  record(response, 'products_search');
}

// The manufacturer filter also goes through the in-memory resolve-and-filter
// batching loop (fetchMatchingPage), so it is tagged on its own.
export function browseByManufacturer(token, manufacturer) {
  const warehouse = catalogWarehouse();
  const response = http.get(
    baseUrl + '/warehouses/' + warehouse.id + '/products?limit=' + PAGE_LIMIT +
      '&manufacturer=' + encodeURIComponent(manufacturer),
    params(token, 'products_by_manufacturer')
  );
  record(response, 'products_by_manufacturer');
}
