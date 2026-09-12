// Covers the manufacturer Searchable Dropdown added to Admin Products and
// Admin Catalog: the new GET /admin/catalog/manufacturers type-ahead
// (productCatalog.service.searchManufacturers), and the `manufacturer`
// filter on both pages' list endpoints.
//
// Runs against its own database (feniq-admin-manufacturer-test) and drops it
// at the end, same pattern as adminProduct.categoryFilter.test.js.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-admin-manufacturer-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const ProductCatalog = require('../src/models/productCatalog.model');

const adminProductService = require('../src/services/adminProduct.service');
const catalogService = require('../src/services/productCatalog.service');

const ids = {};

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-admin-manufacturer-test' });

  const warehouseUser = await User.create({
    name: 'WH', phone: '0950000001', role: 'warehouse', status: 'active',
  });
  const warehouse = await Warehouse.create({
    userId: warehouseUser._id, nameAr: 'م', nameEn: 'W',
    address: 'addr', city: 'Latakia', phone: '0950000001', isActive: true,
  });
  ids.warehouseId = warehouse._id;

  const [gskPanadol, gskAmoxil, bayerAspirin] = await ProductCatalog.create([
    { nameAr: 'بانادول', nameEn: 'Panadol', manufacturerAr: 'جي اس كي', manufacturerEn: 'GSK' },
    { nameAr: 'اموكسيل', nameEn: 'Amoxil', manufacturerAr: 'جي اس كي', manufacturerEn: 'GSK' },
    { nameAr: 'اسبرين', nameEn: 'Aspirin', manufacturerAr: 'باير', manufacturerEn: 'Bayer' },
  ]);
  ids.gskPanadol = gskPanadol._id;
  ids.gskAmoxil = gskAmoxil._id;
  ids.bayerAspirin = bayerAspirin._id;

  await Product.create([
    // Two catalog-linked GSK products.
    { warehouseId: warehouse._id, masterProductId: gskPanadol._id, price: 5 },
    { warehouseId: warehouse._id, masterProductId: gskAmoxil._id, price: 6 },
    // One catalog-linked Bayer product.
    { warehouseId: warehouse._id, masterProductId: bayerAspirin._id, price: 7 },
    // A legacy product (no catalog link) whose OWN manufacturer field is GSK -
    // the two-step match (manufacturerMatchClauses) must catch this too.
    {
      warehouseId: warehouse._id, masterProductId: null, price: 8,
      nameAr: 'مسكن قديم', nameEn: 'Legacy GSK Product', manufacturerAr: 'جي اس كي', manufacturerEn: 'GSK',
    },
  ]);
});

test.after(async () => {
  await stopMemoryMongo();
});

// ---------------------------------------------------------------------------
// GET /admin/catalog/manufacturers (searchManufacturers)
// ---------------------------------------------------------------------------

test('searchManufacturers with no term returns every distinct manufacturer, sorted', async () => {
  const names = await catalogService.searchManufacturers();
  assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.ok(names.includes('جي اس كي'));
  assert.ok(names.includes('باير'));
  assert.strictEqual(new Set(names).size, names.length, 'must be distinct');
});

test('searchManufacturers matches on the Arabic name', async () => {
  const names = await catalogService.searchManufacturers('جي اس كي');
  assert.deepStrictEqual(names, ['جي اس كي']);
});

test('searchManufacturers matches on the English name too', async () => {
  const names = await catalogService.searchManufacturers('Bayer');
  assert.deepStrictEqual(names, ['باير']);
});

test('searchManufacturers with no matches returns an empty array, not an error', async () => {
  const names = await catalogService.searchManufacturers('zzzz-no-such-manufacturer');
  assert.deepStrictEqual(names, []);
});

// ---------------------------------------------------------------------------
// The `manufacturer` filter on Admin Products / Admin Catalog
// ---------------------------------------------------------------------------

test('adminProduct.service: manufacturer filter matches catalog-linked AND legacy products', async () => {
  const { rows } = await adminProductService.listPaginatedAllProducts({
    manufacturer: 'جي اس كي',
    limit: 50,
  });
  assert.strictEqual(rows.length, 3);
  const names = rows.map((r) => r.product.nameEn).sort();
  assert.deepStrictEqual(names, ['Amoxil', 'Legacy GSK Product', 'Panadol']);
});

test('adminProduct.service: manufacturer filter excludes a different manufacturer', async () => {
  const { rows } = await adminProductService.listPaginatedAllProducts({
    manufacturer: 'باير',
    limit: 50,
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].product.nameEn, 'Aspirin');
});

test('adminProduct.service: manufacturer AND search combine (both must match)', async () => {
  // "Panadol" alone would match one GSK product; add the manufacturer filter
  // for a manufacturer that owns no product named "Panadol" -> no rows.
  const noMatch = await adminProductService.listPaginatedAllProducts({
    search: 'Panadol',
    manufacturer: 'باير',
    limit: 50,
  });
  assert.deepStrictEqual(noMatch.rows, []);

  const match = await adminProductService.listPaginatedAllProducts({
    search: 'Panadol',
    manufacturer: 'جي اس كي',
    limit: 50,
  });
  assert.strictEqual(match.rows.length, 1);
  assert.strictEqual(match.rows[0].product.nameEn, 'Panadol');
});

test('productCatalog.service: manufacturer filter is an exact match on the catalog', async () => {
  const { items } = await catalogService.listCatalog({ manufacturer: 'جي اس كي', limit: 50 });
  assert.strictEqual(items.length, 2);
  const ids2 = items.map((i) => String(i._id)).sort();
  assert.deepStrictEqual(ids2, [String(ids.gskAmoxil), String(ids.gskPanadol)].sort());
});
