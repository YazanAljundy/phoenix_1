import http from 'k6/http';
import { check } from 'k6';
import { authParams, baseUrl, pageLimit, responseJson, selectedWarehouseId } from '../config.js';
import { recordStatus } from './metrics.js';

export function browse(token, search = '') {
  const params = authParams(token);
  const warehousesResponse = http.get(`${baseUrl}/warehouses`, { ...params, tags: { endpoint: 'warehouses_list' } });
  recordStatus(warehousesResponse, 'warehouses_list');
  check(warehousesResponse, { 'warehouses returns 200': (item) => item.status === 200 });
  const warehouseId = selectedWarehouseId();
  const categoriesResponse = http.get(`${baseUrl}/categories`, { ...params, tags: { endpoint: 'categories_list' } });
  recordStatus(categoriesResponse, 'categories_list');
  check(categoriesResponse, { 'categories returns 200': (item) => item.status === 200 });
  const query = search ? `&search=${encodeURIComponent(search)}` : '';
  const productsResponse = http.get(
    `${baseUrl}/warehouses/${warehouseId}/products?limit=${pageLimit}${query}`,
    { ...params, tags: { endpoint: search ? 'products_search' : 'products_list' } },
  );
  recordStatus(productsResponse, search ? 'products_search' : 'products_list');
  check(productsResponse, { 'products returns 200': (item) => item.status === 200 });
  const productsBody = responseJson(productsResponse);
  const cursor = productsBody && productsBody.pagination && productsBody.pagination.nextCursor;
  if (cursor) {
    const paginationResponse = http.get(`${baseUrl}/warehouses/${warehouseId}/products?limit=${pageLimit}&after=${encodeURIComponent(cursor)}`, {
      ...params, tags: { endpoint: 'products_pagination' },
    });
    recordStatus(paginationResponse, 'products_pagination');
  }
}
