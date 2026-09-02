// Regression tests for the catalog read paths that were moved from
// "load the whole warehouse catalog into Node and filter it there" to
// "let MongoDB do the filtering".
//
// The assertions are not hand-written expectations: each test runs the
// ORIGINAL algorithm (populate everything -> resolve identity -> filter in
// memory) as an oracle and requires the optimised service to return exactly
// the same rows, in the same order. That is what makes this a behaviour-
// preservation test rather than a re-specification.
//
// Runs against its own database (phoenix-catalog-test) and drops it at the
// end, so it never touches the development data.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-catalog-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-catalog-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const Product = require('../src/models/product.model');
const ProductCatalog = require('../src/models/productCatalog.model');
const Warehouse = require('../src/models/warehouse.model');
const User = require('../src/models/user.model');
const productService = require('../src/services/product.service');
const productViewModel = require('../src/viewmodels/product.viewmodel');
const { applyResolvedIdentity, escapeRegex } = require('../src/services/productCatalog.service');

const WAREHOUSE_ID = new mongoose.Types.ObjectId();
const OTHER_WAREHOUSE_ID = new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// The oracle: the exact code these paths used before the optimisation.
// ---------------------------------------------------------------------------

async function originalSearch(warehouseId, { search, manufacturer, categoryId } = {}) {
  const baseFilter = { warehouseId, isActive: true };
  if (categoryId) baseFilter.categoryId = categoryId;

  let products = await Product.find(baseFilter).populate('masterProductId');
  products.forEach(applyResolvedIdentity);

  if (manufacturer) {
    products = products.filter((p) => p.manufacturerAr === manufacturer);
  }

  const pattern = new RegExp(escapeRegex(search.trim()), 'i');
  products = products.filter(
    (p) =>
      pattern.test(p.nameAr || '') ||
      pattern.test(p.nameEn || '') ||
      pattern.test(p.manufacturerAr || '') ||
      pattern.test(p.manufacturerEn || '')
  );
  products.sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''));
  return products;
}

async function originalManufacturers(warehouseId) {
  const products = await Product.find({ warehouseId, isActive: true }).populate('masterProductId');
  products.forEach(applyResolvedIdentity);
  const manufacturers = [...new Set(products.map((p) => p.manufacturerAr).filter(Boolean))];
  manufacturers.sort((a, b) => a.localeCompare(b));
  return manufacturers;
}

// Comparable shape: id plus the four resolved identity fields, which is what
// the filtering and ordering are actually about.
function fingerprint(rows) {
  return rows.map((row) => {
    const product = row.product || row;
    return [
      String(product._id),
      product.nameAr,
      product.nameEn,
      product.manufacturerAr,
      product.manufacturerEn,
    ].join('|');
  });
}

// ---------------------------------------------------------------------------
// Fixtures - deliberately awkward, to cover the branches that differ.
// ---------------------------------------------------------------------------

async function seed() {
  const warehouseUserId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  await User.create([
    { _id: warehouseUserId, name: 'WH', phone: '0900000001', role: 'warehouse', status: 'active' },
    { _id: otherUserId, name: 'WH2', phone: '0900000002', role: 'warehouse', status: 'active' },
  ]);
  await Warehouse.create([
    {
      _id: WAREHOUSE_ID, userId: warehouseUserId, nameAr: 'م', nameEn: 'W',
      address: 'a', city: 'Latakia', phone: '0900000001', isActive: true,
    },
    {
      _id: OTHER_WAREHOUSE_ID, userId: otherUserId, nameAr: 'م2', nameEn: 'W2',
      address: 'a', city: 'Latakia', phone: '0900000002', isActive: true,
    },
  ]);

  // Catalog entries. `deactivated` is the important one: deactivating a
  // catalog item is a soft flag and populate still resolves it, so a search
  // must still find products linked to it.
  const [panadol, aspirin, deactivated, arabicOnly] = await ProductCatalog.create([
    { nameAr: 'بانادول', nameEn: 'Panadol', manufacturerAr: 'جي اس كي', manufacturerEn: 'GSK' },
    { nameAr: 'اسبرين', nameEn: 'Aspirin', manufacturerAr: 'باير', manufacturerEn: 'Bayer' },
    {
      nameAr: 'دواء موقوف', nameEn: 'Discontinued Drug',
      manufacturerAr: 'شركة موقوفة', manufacturerEn: 'Halted Co', isActive: false,
    },
    // No English name at all: resolution must return the catalog's null, not
    // fall back to the product's own legacy value.
    { nameAr: 'كبسولات', nameEn: null, manufacturerAr: 'الرازي', manufacturerEn: null },
  ]);

  await Product.create([
    // Catalog-linked. Their own name fields are intentionally populated with
    // misleading values that resolution must overwrite and search must ignore.
    {
      warehouseId: WAREHOUSE_ID, masterProductId: panadol._id, price: 5,
      nameAr: 'IGNORE-ME', nameEn: 'IGNORE-ME', manufacturerAr: 'IGNORE', manufacturerEn: 'IGNORE',
      isActive: true, isAvailable: true,
    },
    {
      warehouseId: WAREHOUSE_ID, masterProductId: aspirin._id, price: 6,
      isActive: true, isAvailable: true,
    },
    {
      warehouseId: WAREHOUSE_ID, masterProductId: deactivated._id, price: 7,
      isActive: true, isAvailable: true,
    },
    {
      warehouseId: WAREHOUSE_ID, masterProductId: arabicOnly._id, price: 8,
      nameEn: 'SHOULD-NOT-MATCH', isActive: true, isAvailable: true,
    },
    // Legacy (masterProductId null): identity comes from its own fields.
    {
      warehouseId: WAREHOUSE_ID, masterProductId: null, price: 9,
      nameAr: 'ليجاسي', nameEn: 'Legacy Tablet', manufacturerAr: 'قديم', manufacturerEn: 'Legacy Co',
      isActive: true, isAvailable: true,
    },
    // A regex-special name, to prove escapeRegex behaviour is preserved.
    {
      warehouseId: WAREHOUSE_ID, masterProductId: null, price: 10,
      nameAr: 'خاص', nameEn: 'Special (50%) [strong]+', manufacturerAr: 'قديم', manufacturerEn: 'Legacy Co',
      isActive: true, isAvailable: true,
    },
    // isActive:false must never appear in any result.
    {
      warehouseId: WAREHOUSE_ID, masterProductId: null, price: 11,
      nameAr: 'محذوف', nameEn: 'Panadol Inactive', manufacturerAr: 'مخفي', manufacturerEn: 'Hidden',
      isActive: false, isAvailable: true,
    },
    // Belongs to a different warehouse - isolation check.
    {
      warehouseId: OTHER_WAREHOUSE_ID, masterProductId: panadol._id, price: 12,
      isActive: true, isAvailable: true,
    },
    {
      warehouseId: OTHER_WAREHOUSE_ID, masterProductId: null, price: 13,
      nameAr: 'اخر', nameEn: 'Other Warehouse Legacy', manufacturerAr: 'اخر', manufacturerEn: 'Other Co',
      isActive: true, isAvailable: true,
    },
  ]);
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await seed();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const SEARCH_TERMS = [
  'Panadol',        // one match, via the linked catalog entry
  'panadol',        // case-insensitive
  'a',              // many matches
  'Legacy',         // legacy product, via its own fields
  'Bayer',          // matched on manufacturerEn
  'جي اس كي',       // matched on manufacturerAr (Arabic)
  'بانادول',        // matched on nameAr (Arabic)
  'Discontinued',   // linked to a DEACTIVATED catalog entry - must still match
  'كبسولات',        // catalog entry whose nameEn is null
  'IGNORE-ME',      // a linked product's own stale fields - must NOT match
  'SHOULD-NOT-MATCH', // ditto
  'zzzz-no-such-product', // no matches
  'Special (50%) [strong]+', // regex-special characters
  '(50%)',          // regex-special substring
  '',               // handled by the caller as "no search"; here it is trimmed away
];

for (const term of SEARCH_TERMS) {
  if (!term.trim()) continue;
  test(`search "${term}" returns exactly what the original algorithm returned`, async () => {
    const expected = await originalSearch(WAREHOUSE_ID, { search: term });
    const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, { search: term });
    assert.deepStrictEqual(
      fingerprint(items),
      fingerprint(expected),
      `search "${term}" diverged from the original implementation`
    );
  });
}

test('search with one match returns exactly one row', async () => {
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, { search: 'Panadol' });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].product.nameEn, 'Panadol');
});

test('search with no matches returns an empty list, not an error', async () => {
  const { items, hasMore, nextCursor } = await productService.listWarehouseProducts(
    WAREHOUSE_ID, { search: 'zzzz-no-such-product' }
  );
  assert.deepStrictEqual(items, []);
  assert.strictEqual(hasMore, false);
  assert.strictEqual(nextCursor, null);
});

test('search never matches a linked product on its own stale identity fields', async () => {
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, { search: 'IGNORE-ME' });
  assert.deepStrictEqual(items, []);
});

test('search still finds products linked to a DEACTIVATED catalog entry', async () => {
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, { search: 'Discontinued' });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].product.nameEn, 'Discontinued Drug');
});

test('search excludes isActive:false products', async () => {
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, { search: 'Panadol' });
  assert.ok(items.every((i) => i.product.nameEn !== 'Panadol Inactive'));
});

test('search is isolated to the requested warehouse', async () => {
  const mine = await productService.listWarehouseProducts(WAREHOUSE_ID, { search: 'Panadol' });
  const theirs = await productService.listWarehouseProducts(OTHER_WAREHOUSE_ID, { search: 'Panadol' });
  assert.strictEqual(mine.items.length, 1);
  assert.strictEqual(theirs.items.length, 1);
  assert.notStrictEqual(
    String(mine.items[0].product._id),
    String(theirs.items[0].product._id),
    'the two warehouses must return their own product, not a shared one'
  );

  const otherOnly = await productService.listWarehouseProducts(WAREHOUSE_ID, {
    search: 'Other Warehouse Legacy',
  });
  assert.deepStrictEqual(otherOnly.items, [], 'must not leak another warehouse\'s product');
});

test('search combined with a manufacturer filter matches the original', async () => {
  const expected = await originalSearch(WAREHOUSE_ID, { search: 'a', manufacturer: 'قديم' });
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, {
    search: 'a', manufacturer: 'قديم',
  });
  assert.deepStrictEqual(fingerprint(items), fingerprint(expected));
  assert.ok(items.length > 0, 'fixture should produce at least one row for this combination');
});

test('search response keeps its shape: items carry product, offer and discount', async () => {
  const { items, hasMore, nextCursor } = await productService.listWarehouseProducts(
    WAREHOUSE_ID, { search: 'Panadol' }
  );
  assert.strictEqual(hasMore, false, 'search is unpaginated and must keep saying so');
  assert.strictEqual(nextCursor, null);
  assert.ok('product' in items[0]);
  assert.ok('offer' in items[0]);
  assert.ok('manufacturerDiscountPercentage' in items[0]);
});

// The .select() projection on the catalog Product query must not starve the
// viewmodel: every field toProductListResponse emits has to survive it.
test('the catalog list viewmodel is unchanged by the product projection', async () => {
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, { limit: 100 });
  const { products } = productViewModel.toProductListResponse(items);
  assert.ok(products.length >= 5);

  for (const row of products) {
    assert.deepStrictEqual(
      Object.keys(row).sort(),
      ['discountPriceUsd', 'id', 'image', 'isAvailable', 'manufacturerAr', 'manufacturerEn',
        'nameAr', 'nameEn', 'offer', 'priceUsd', 'unitAr', 'unitEn', 'categoryId'].sort()
    );
    assert.strictEqual(typeof row.priceUsd, 'number', 'priceUsd must be a real number, not undefined');
    assert.strictEqual(typeof row.discountPriceUsd, 'number');
    assert.strictEqual(typeof row.isAvailable, 'boolean');
  }

  // The legacy fixture product carries a real price - it must round-trip.
  const legacy = products.find((p) => p.nameEn === 'Legacy Tablet');
  assert.ok(legacy);
  assert.strictEqual(legacy.priceUsd, 9);
  assert.strictEqual(legacy.isAvailable, true);

  const linked = products.find((p) => p.nameEn === 'Panadol');
  assert.strictEqual(linked.priceUsd, 5, 'a catalog-linked product keeps its own price, resolves its name');
});

// ---------------------------------------------------------------------------
// Pagination (the non-search path)
// ---------------------------------------------------------------------------

test('cursor pagination still walks every active product exactly once', async () => {
  const seen = [];
  let after = null;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await productService.listWarehouseProducts(WAREHOUSE_ID, { limit: 2, after });
    seen.push(...page.items.map((i) => String(i.product._id)));
    if (!page.hasMore) break;
    after = page.nextCursor;
    assert.ok(after, 'hasMore implies a cursor');
  }
  const activeIds = (await Product.find({ warehouseId: WAREHOUSE_ID, isActive: true }, '_id').lean())
    .map((p) => String(p._id));
  assert.deepStrictEqual([...seen].sort(), [...activeIds].sort());
  assert.strictEqual(new Set(seen).size, seen.length, 'no product may repeat across pages');
});

test('pagination resolves identity the same way search does', async () => {
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, { limit: 100 });
  const linked = items.find((i) => i.product.nameEn === 'Panadol');
  assert.ok(linked, 'the linked product must resolve to its catalog name');
  assert.strictEqual(linked.product.manufacturerAr, 'جي اس كي');
  const nulled = items.find((i) => i.product.nameAr === 'كبسولات');
  assert.strictEqual(nulled.product.nameEn, null, 'a catalog null must not fall back to the legacy field');
});

test('manufacturer filter on the paginated path matches the original resolution', async () => {
  const { items } = await productService.listWarehouseProducts(WAREHOUSE_ID, {
    limit: 100, manufacturer: 'قديم',
  });
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.product.manufacturerAr === 'قديم'));
});

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

test('manufacturers list is identical to the original algorithm', async () => {
  const expected = await originalManufacturers(WAREHOUSE_ID);
  const actual = await productService.listDistinctManufacturersForWarehouse(WAREHOUSE_ID);
  assert.deepStrictEqual(actual, expected);
});

test('manufacturers include both linked and legacy products, and stay sorted', async () => {
  const actual = await productService.listDistinctManufacturersForWarehouse(WAREHOUSE_ID);
  assert.ok(actual.includes('جي اس كي'), 'from a linked catalog entry');
  assert.ok(actual.includes('قديم'), 'from a legacy product');
  assert.ok(actual.includes('شركة موقوفة'), 'from a DEACTIVATED catalog entry, as before');
  assert.ok(!actual.includes('IGNORE'), 'never a linked product\'s stale own field');
  assert.ok(!actual.includes('مخفي'), 'never an isActive:false product');
  assert.deepStrictEqual(actual, [...actual].sort((a, b) => a.localeCompare(b)));
  assert.strictEqual(new Set(actual).size, actual.length, 'values must be distinct');
});

test('manufacturers are isolated per warehouse', async () => {
  const mine = await productService.listDistinctManufacturersForWarehouse(WAREHOUSE_ID);
  const theirs = await productService.listDistinctManufacturersForWarehouse(OTHER_WAREHOUSE_ID);
  assert.ok(theirs.includes('اخر'));
  assert.ok(!mine.includes('اخر'), 'must not leak another warehouse\'s manufacturer');
});

test('manufacturers for a warehouse with no products is an empty array', async () => {
  const emptyUserId = new mongoose.Types.ObjectId();
  const emptyWarehouseId = new mongoose.Types.ObjectId();
  await User.create({
    _id: emptyUserId, name: 'Empty', phone: '0900000003', role: 'warehouse', status: 'active',
  });
  await Warehouse.create({
    _id: emptyWarehouseId, userId: emptyUserId, nameAr: 'ف', nameEn: 'Empty',
    address: 'a', city: 'Latakia', phone: '0900000003', isActive: true,
  });
  const actual = await productService.listDistinctManufacturersForWarehouse(emptyWarehouseId);
  assert.deepStrictEqual(actual, []);
});
