// computeOrderFingerprint used to build its own sha256 by hand
// (`order-v1:${JSON.stringify(...)}`), then moved onto the shared
// requestFingerprint helper (utils/idempotency.js) that payment.service.js
// already used. This is a database-facing format: every Order already
// written carries the OLD function's output in idempotencyFingerprint
// (order.model.js), and a retry of that order after this change re-derives
// the fingerprint with the NEW code and compares it against the OLD stored
// value (order.service.js's replayOrRejectIdempotentOrder). If the two ever
// disagree for the same logical request, every existing keyed order would
// refuse its own retries with IDEMPOTENCY_KEY_REUSED.
//
// These are fixed, literal expected hashes - not "does the new code equal
// the old code", which would stop catching anything the moment the old
// inline version is deleted. If this test ever needs to change, the format
// changed, and the `order-v1:` scope prefix must become `order-v2:` (or
// later) so already-stored fingerprints are not silently reinterpreted.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-fingerprint-migration';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { computeOrderFingerprint, normalizePackageRequests } = require('../src/services/order.service');
const { requestFingerprint } = require('../src/utils/idempotency');

function fp({ warehouseId = 'w1', items = [], packages = null, advertisementId = null, notes = null } = {}) {
  return computeOrderFingerprint({
    warehouseId,
    items,
    packageRequests: normalizePackageRequests({ packages, advertisementId }),
    notes,
  });
}

// The exact algorithm the OLD inline implementation ran, reproduced
// independently here (not imported from production code) so this test can
// never accidentally start comparing the new code against itself.
function oldAlgorithmFingerprint({ warehouseId, items = [], packages = null, advertisementId = null, notes = null }) {
  function compareStrings(a, b) {
    if (a < b) return -1;
    return a > b ? 1 : 0;
  }
  function mergeDuplicateItems(list) {
    const byProduct = new Map();
    for (const item of list) {
      const key = String(item.productId);
      const existing = byProduct.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        byProduct.set(key, { ...item });
      }
    }
    return [...byProduct.values()];
  }
  const packageRequests = normalizePackageRequests({ packages, advertisementId });
  const lines = mergeDuplicateItems(Array.isArray(items) ? items : [])
    .map((item) => [
      String(item.productId),
      item.quantity,
      item.displayedUnitPriceUsd === null || item.displayedUnitPriceUsd === undefined
        ? null
        : Math.round(item.displayedUnitPriceUsd * 100),
    ])
    .sort((a, b) => compareStrings(a[0], b[0]));
  const packageLines = packageRequests
    .map((request) => [String(request.advertisementId), request.copies, request.fromLegacyField])
    .sort((a, b) => compareStrings(a[0], b[0]));
  const trimmedNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;
  const canonical = JSON.stringify({
    warehouseId: String(warehouseId),
    items: lines,
    packages: packageLines,
    notes: trimmedNotes,
  });
  return crypto.createHash('sha256').update(`order-v1:${canonical}`).digest('hex');
}

test('the production function still equals the old inline algorithm, reproduced independently', () => {
  const cases = [
    { warehouseId: 'w1', items: [], notes: null },
    { warehouseId: 'w1', items: [{ productId: 'p1', quantity: 2, displayedUnitPriceUsd: 10 }], notes: 'back door' },
    {
      warehouseId: 'w1',
      items: [{ productId: 'p1', quantity: 2, displayedUnitPriceUsd: null }],
      notes: '  spaced  ',
    },
    {
      warehouseId: 'w2',
      items: [
        { productId: 'p2', quantity: 1, displayedUnitPriceUsd: 5 },
        { productId: 'p1', quantity: 3, displayedUnitPriceUsd: 9.99 },
      ],
      packages: [{ advertisementId: 'ad1', copies: 2 }],
      notes: null,
    },
    { warehouseId: 'w3', items: [], advertisementId: 'ad1', notes: 'مرحباً 🎉' },
    {
      warehouseId: '507f1f77bcf86cd799439011',
      items: [{ productId: 'p1', quantity: 100000, displayedUnitPriceUsd: 0 }],
      notes: '',
    },
  ];
  for (const c of cases) {
    const { warehouseId, items, packages, advertisementId, notes } = c;
    assert.strictEqual(
      fp({ warehouseId, items, packages, advertisementId, notes }),
      oldAlgorithmFingerprint({ warehouseId, items, packages, advertisementId, notes }),
      `mismatch for ${JSON.stringify(c)}`
    );
  }
});

// Fixed, literal expected hashes - computed once against the pre-migration
// (crypto.createHash('sha256').update(`order-v1:...`)) implementation and
// hard-coded here, so a silent format drift fails even if someone later
// deletes oldAlgorithmFingerprint above.
test('fixed fingerprints for known inputs never move', () => {
  assert.strictEqual(
    fp({ warehouseId: 'w1', items: [], notes: null }),
    '922745b7f62d850e6ca280c7ddcf3b4fbadc1506e82286c5fb119ac09b3d64d1'
  );
  assert.strictEqual(
    fp({
      warehouseId: 'w1',
      items: [{ productId: 'p1', quantity: 2, displayedUnitPriceUsd: 10 }],
      notes: 'back door',
    }),
    'bebbf274dcc3235bad0b7e26dabe1f0249dd8a6a824574ebf1c365a10f7cf332'
  );
  assert.strictEqual(
    fp({
      warehouseId: 'w2',
      items: [
        { productId: 'p2', quantity: 1, displayedUnitPriceUsd: 5 },
        { productId: 'p1', quantity: 3, displayedUnitPriceUsd: 9.99 },
      ],
      packages: [{ advertisementId: 'ad1', copies: 2 }],
      notes: null,
    }),
    '14cb6f32bce3d93fa7bbebc6e693a8d55e3042a3e2f0ab52d37857410f435379'
  );
  assert.strictEqual(
    fp({
      warehouseId: '507f1f77bcf86cd799439011',
      items: [{ productId: 'p1', quantity: 100000, displayedUnitPriceUsd: 0 }],
      notes: '',
    }),
    'e2a7cc66b374cedeeefd740569b65ac643624a02b9875525dbdd8e05e3e45233'
  );
});

test('every stored fingerprint format is still order-v1 (the scope requestFingerprint is called with)', () => {
  const source = require('fs').readFileSync(require.resolve('../src/services/order.service.js'), 'utf8');
  assert.match(
    source,
    /requestFingerprint\('order-v1',/,
    "the scope must stay 'order-v1' - changing it would make every stored " +
      'Order.idempotencyFingerprint mismatch its own recomputed value on retry'
  );
});

test('requestFingerprint is a real sha256 hex digest, same length/shape as before', () => {
  const value = fp({ warehouseId: 'w1', items: [{ productId: 'p1', quantity: 1, displayedUnitPriceUsd: 1 }] });
  assert.match(value, /^[0-9a-f]{64}$/);
});
