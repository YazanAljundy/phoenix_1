/**
 * Catalog-size scaling probe (Phase 8 evidence).
 *
 * Concurrency is deliberately 1. The progressive sweep answers "how much load
 * can the system take"; this answers the different question "which endpoints
 * get slower because the DATA got bigger, independently of load" - which is
 * what separates an algorithmic problem from a capacity problem.
 *
 * The fixture warehouses hold 200, 1,000 and 5,000 products. If an endpoint's
 * latency tracks that number, its cost is in the size of the result set it
 * pulls and hydrates, not in concurrency, and adding CPU will not fix it.
 */
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME = path.join(__dirname, '.runtime');
const fixtures = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'load-fixtures.json'), 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'tokens.json'), 'utf8'));
const API_BASE = process.env.BASE_URL || fixtures.baseUrl;
const RESULT_DIR = path.join(__dirname, 'results', 'scaling');

const REPEATS = Number(process.env.SCALING_REPEATS || 15);
const WARMUP = 3;

let ipSeq = 0;
function nextIp() {
  ipSeq += 1;
  return '10.220.' + ((ipSeq >> 8) & 255) + '.' + (ipSeq & 255);
}

async function measure(label, url, token) {
  const samples = [];
  let bytes = 0;
  let status = 0;
  for (let i = 0; i < REPEATS + WARMUP; i += 1) {
    const started = process.hrtime.bigint();
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, 'X-Forwarded-For': nextIp() },
    });
    const body = await response.arrayBuffer();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    status = response.status;
    bytes = body.byteLength;
    // The first few calls warm the connection, the query planner and the JIT;
    // including them would report startup cost as endpoint cost.
    if (i >= WARMUP) samples.push(ms);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    status,
    responseBytes: bytes,
    medMs: Number(samples[Math.floor(samples.length / 2)].toFixed(1)),
    minMs: Number(samples[0].toFixed(1)),
    maxMs: Number(samples[samples.length - 1].toFixed(1)),
    avgMs: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1)),
  };
}

// The fixture catalogs are legacy-shaped (masterProductId null), so
// .populate('masterProductId') resolves to nothing for them. The warehouse
// that was already in this database is the opposite: every one of its products
// is catalog-linked, so the same endpoints additionally hydrate a
// ProductCatalog document per row. Including it here is what shows whether the
// fixture numbers understate the real cost.
async function discoverLinkedWarehouse(token) {
  const explicit = process.env.LINKED_WAREHOUSE_ID;
  if (explicit) return { id: explicit, size: Number(process.env.LINKED_WAREHOUSE_SIZE || 0), linked: true };
  const response = await fetch(API_BASE + '/warehouses', {
    headers: { Authorization: 'Bearer ' + token, 'X-Forwarded-For': nextIp() },
  });
  if (!response.ok) return null;
  const body = await response.json();
  const fixtureIds = new Set(fixtures.catalogWarehouses.map((w) => w.id));
  for (const warehouse of body.warehouses || []) {
    const id = String(warehouse.id || warehouse._id);
    if (fixtureIds.has(id)) continue;
    const products = await fetch(API_BASE + '/warehouses/' + id + '/products?limit=1', {
      headers: { Authorization: 'Bearer ' + token, 'X-Forwarded-For': nextIp() },
    });
    if (!products.ok) continue;
    const page = await products.json();
    if (page.products && page.products.length) return { id, size: null, linked: true };
  }
  return null;
}

async function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const token = tokens.pharmacyTokens[0].token;

  const linked = await discoverLinkedWarehouse(token);
  const catalogs = [
    ...fixtures.catalogWarehouses.map((w) => ({ id: w.id, label: w.size + ' products', size: w.size })),
    ...(linked ? [{ id: linked.id, label: 'pre-existing (catalog-linked)', size: 'linked' }] : []),
  ];

  const results = [];
  console.log('Catalog-size scaling (concurrency 1, ' + REPEATS + ' samples after ' + WARMUP + ' warm-ups)\n');
  const header = 'endpoint'.padEnd(34) + '  ' + catalogs
    .map((w) => w.label.padStart(22)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  const cases = [
    { key: 'products_list_page1', path: (id) => '/warehouses/' + id + '/products?limit=20' },
    { key: 'products_search', path: (id) => '/warehouses/' + id + '/products?search=Medicine' },
    { key: 'products_search_narrow', path: (id) => '/warehouses/' + id + '/products?search=Medicine%205000-4999' },
    { key: 'products_by_manufacturer', path: (id) => '/warehouses/' + id + '/products?limit=20&manufacturer=' + encodeURIComponent('Manufacturer Alpha') },
    { key: 'warehouse_manufacturers', path: (id) => '/warehouses/' + id + '/manufacturers' },
    { key: 'warehouse_profile', path: (id) => '/warehouses/' + id + '/profile' },
  ];

  const fixtureSizes = fixtures.catalogWarehouses.map((w) => w.size);
  for (const testCase of cases) {
    const row = { endpoint: testCase.key, bySize: {} };
    const cells = [];
    for (const warehouse of catalogs) {
      const measurement = await measure(
        testCase.key, API_BASE + testCase.path(warehouse.id), token
      );
      row.bySize[warehouse.size] = measurement;
      cells.push((measurement.medMs + 'ms/' + Math.round(measurement.responseBytes / 1024) + 'KB').padStart(22));
    }
    const first = row.bySize[fixtureSizes[0]].medMs;
    const last = row.bySize[fixtureSizes[fixtureSizes.length - 1]].medMs;
    row.growthFactor = Number((last / first).toFixed(2));
    row.dataGrowthFactor = Number((fixtureSizes[fixtureSizes.length - 1] / fixtureSizes[0]).toFixed(2));
    // ~1 means the endpoint is flat in catalog size; approaching the data
    // growth factor means it is linear in it.
    row.scalesWithCatalog = row.growthFactor > 2;
    results.push(row);
    console.log(testCase.key.padEnd(34) + '  ' + cells.join('') +
      '   x' + row.growthFactor + (row.scalesWithCatalog ? '  <-- scales with catalog size' : ''));
  }

  console.log('\nData grew ' + results[0].dataGrowthFactor + 'x between the smallest and largest fixture catalog.');

  fs.writeFileSync(path.join(RESULT_DIR, 'catalog-scaling.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    repeats: REPEATS,
    catalogs,
    catalogSizes: catalogs.map((c) => c.size),
    results,
  }, null, 2));
  console.log('Written to ' + path.join(RESULT_DIR, 'catalog-scaling.json'));
}

main().catch((error) => {
  console.error('catalog-scaling FAILED: ' + error.message);
  process.exitCode = 1;
});
