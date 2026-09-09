// The warehouse catalog page's company drill-down, both halves of it:
//
//   1. listCatalogManufacturersForWarehouse - the company cards, which have to
//      come from the products the warehouse actually has, not from the Excel
//      import registry (that one misses manually added products and keeps
//      companies whose products are all gone).
//   2. listPaginatedProductsForWarehouse({ manufacturerAr }) - opening a card,
//      which must be an EXACT company match and must keep paginating within
//      that company.
//
// A product's manufacturer normally lives on its linked ProductCatalog entry
// (masterProductId), not on the product row, so both paths are covered here.
//
// Own database, dropped at the end.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-manufacturer-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const ProductCatalog = require('../src/models/productCatalog.model');
const WarehouseManufacturer = require('../src/models/warehouseManufacturer.model');

const { listPaginatedProductsForWarehouse } = require('../src/services/warehouseProduct.service');
const {
  listCatalogManufacturersForWarehouse,
  listManufacturersForWarehouse,
} = require('../src/services/warehouseManufacturer.service');

const ids = {};

async function productsOf(manufacturerAr, options = {}) {
  const { rows } = await listPaginatedProductsForWarehouse(ids.warehouse, {
    manufacturerAr,
    limit: 50,
    ...options,
  });
  return rows.map((p) => p.nameEn ?? p.nameAr).sort();
}

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-warehouse-manufacturers-test' });

  const [whUser, otherWhUser] = await User.create([
    { name: 'WH', phone: '0942000601', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000602', role: 'warehouse', status: 'active' },
  ]);
  const [warehouse, otherWarehouse] = await Warehouse.create([
    { userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia', phone: '0942000601', deliveryType: 'self', isActive: true },
    { userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia', phone: '0942000602', deliveryType: 'self', isActive: true },
  ]);
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;

  // Catalog-linked products: name and manufacturer live on the catalog entry.
  const catalogEntries = await ProductCatalog.create([
    { nameAr: 'باراسيتامول', nameEn: 'Paracetamol', manufacturerAr: 'ابن الهيثم', manufacturerEn: 'Ibn Al Haytham', isActive: true },
    { nameAr: 'أموكسيسيلين', nameEn: 'Amoxicillin', manufacturerAr: 'ابن الهيثم', manufacturerEn: 'Ibn Al Haytham', isActive: true },
    { nameAr: 'فيتامين سي', nameEn: 'Vitamin C', manufacturerAr: 'باريش', manufacturerEn: 'Barish', isActive: true },
  ]);
  await Product.create(
    catalogEntries.map((entry, index) => ({
      warehouseId: ids.warehouse,
      masterProductId: entry._id,
      price: index + 1,
      isAvailable: true,
      isActive: true,
    }))
  );

  // A legacy product carrying its own identity fields (pre catalog-link).
  await Product.create({
    warehouseId: ids.warehouse,
    nameAr: 'شراب اكس',
    nameEn: 'Syrup X',
    manufacturerAr: 'شركة قديمة',
    manufacturerEn: 'Legacy Pharma',
    price: 7,
    isAvailable: true,
    isActive: true,
  });

  // Deactivated: its company must not appear, and it must not be listed.
  const retired = await Product.create({
    warehouseId: ids.warehouse,
    nameAr: 'دواء متوقف',
    nameEn: 'Retired Drug',
    manufacturerAr: 'شركة منتهية',
    manufacturerEn: 'Gone Pharma',
    price: 8,
    isActive: true,
  });
  await Product.updateOne({ _id: retired._id }, { isActive: false });

  // A legacy row with no manufacturer at all - must not become a nameless card.
  await Product.create({
    warehouseId: ids.warehouse,
    nameAr: 'بدون شركة',
    nameEn: 'No Company',
    price: 9,
    isAvailable: true,
    isActive: true,
  });

  // Another warehouse's product, under a company name of its own.
  await Product.create({
    warehouseId: ids.otherWarehouse,
    nameAr: 'دواء أجنبي',
    nameEn: 'Foreign Drug',
    manufacturerAr: 'شركة أخرى',
    manufacturerEn: 'Other Pharma',
    price: 10,
    isAvailable: true,
    isActive: true,
  });

  // The import registry: one company that has no products (imported, never
  // linked) and deliberately missing 'باريش', whose products were added
  // through the form rather than an upload.
  await WarehouseManufacturer.create([
    { warehouseId: ids.warehouse, manufacturerAr: 'ابن الهيثم' },
    { warehouseId: ids.warehouse, manufacturerAr: 'شركة بلا منتجات' },
  ]);
});

test.after(async () => {
  await stopMemoryMongo();
});

// ---------------------------------------------------------------------------
// The company cards
// ---------------------------------------------------------------------------

test('lists every company the catalog actually holds, alphabetically', async () => {
  const rows = await listCatalogManufacturersForWarehouse(ids.warehouse);
  assert.deepStrictEqual(
    rows.map((row) => row.manufacturerAr),
    ['ابن الهيثم', 'باريش', 'شركة قديمة']
  );
});

test('counts the products under each company', async () => {
  const rows = await listCatalogManufacturersForWarehouse(ids.warehouse);
  const countOf = (name) => rows.find((row) => row.manufacturerAr === name)?.productCount;
  assert.strictEqual(countOf('ابن الهيثم'), 2);
  assert.strictEqual(countOf('باريش'), 1);
  assert.strictEqual(countOf('شركة قديمة'), 1);
});

test('carries the English name along for the panel to label the card with', async () => {
  const rows = await listCatalogManufacturersForWarehouse(ids.warehouse);
  const englishOf = (name) => rows.find((row) => row.manufacturerAr === name)?.manufacturerEn;
  assert.strictEqual(englishOf('ابن الهيثم'), 'Ibn Al Haytham');
  assert.strictEqual(englishOf('شركة قديمة'), 'Legacy Pharma');
});

test('a deactivated product does not keep its company on the list', async () => {
  const rows = await listCatalogManufacturersForWarehouse(ids.warehouse);
  assert.ok(!rows.some((row) => row.manufacturerAr === 'شركة منتهية'));
});

test('a product with no manufacturer produces no nameless card', async () => {
  const rows = await listCatalogManufacturersForWarehouse(ids.warehouse);
  assert.ok(rows.every((row) => Boolean(row.manufacturerAr)));
});

test("never lists another warehouse's companies", async () => {
  const rows = await listCatalogManufacturersForWarehouse(ids.warehouse);
  assert.ok(!rows.some((row) => row.manufacturerAr === 'شركة أخرى'));
});

// This is the whole reason the catalog page does not reuse the Discounts tab's
// list: browsing by a registry would hide 'باريش' (added through the form, so
// never registered) and offer 'شركة بلا منتجات', which opens onto nothing.
test('differs from the import registry, which is why browsing does not use it', async () => {
  const registry = await listManufacturersForWarehouse(ids.warehouse);
  assert.deepStrictEqual(registry, ['ابن الهيثم', 'شركة بلا منتجات']);

  const browsable = (await listCatalogManufacturersForWarehouse(ids.warehouse)).map(
    (row) => row.manufacturerAr
  );
  assert.ok(browsable.includes('باريش'), 'a form-added company must still be browsable');
  assert.ok(!browsable.includes('شركة بلا منتجات'), 'an empty company must not get a card');
});

// ---------------------------------------------------------------------------
// Opening a card
// ---------------------------------------------------------------------------

test('opening a company returns exactly its products', async () => {
  assert.deepStrictEqual(await productsOf('ابن الهيثم'), ['Amoxicillin', 'Paracetamol']);
  assert.deepStrictEqual(await productsOf('باريش'), ['Vitamin C']);
});

test('finds a legacy product by the manufacturer stored on the row itself', async () => {
  assert.deepStrictEqual(await productsOf('شركة قديمة'), ['Syrup X']);
});

test('the match is exact, not a search', async () => {
  // 'ابن' is a prefix of a real company here - a regex filter would return its
  // two products instead of nothing.
  assert.deepStrictEqual(await productsOf('ابن'), []);
  assert.deepStrictEqual(await productsOf('Ibn Al Haytham'), []);
});

test('no manufacturer at all still returns the whole catalog', async () => {
  const all = await productsOf(null);
  assert.deepStrictEqual(all, ['Amoxicillin', 'No Company', 'Paracetamol', 'Syrup X', 'Vitamin C']);
  assert.deepStrictEqual(await productsOf(''), all);
  assert.deepStrictEqual(await productsOf('   '), all);
});

test('a deactivated product is not returned under its company', async () => {
  assert.deepStrictEqual(await productsOf('شركة منتهية'), []);
});

test("never returns another warehouse's products", async () => {
  assert.deepStrictEqual(await productsOf('شركة أخرى'), []);
});

test('pagination stays inside the open company, with no repeats and no gaps', async () => {
  const first = await listPaginatedProductsForWarehouse(ids.warehouse, {
    manufacturerAr: 'ابن الهيثم',
    limit: 1,
  });
  assert.strictEqual(first.rows.length, 1);
  assert.strictEqual(first.hasMore, true);

  const second = await listPaginatedProductsForWarehouse(ids.warehouse, {
    manufacturerAr: 'ابن الهيثم',
    limit: 1,
    after: first.nextCursor,
  });
  assert.strictEqual(second.rows.length, 1);
  assert.strictEqual(second.hasMore, false, 'the company has two products, not the catalog\'s five');
  assert.notStrictEqual(String(first.rows[0]._id), String(second.rows[0]._id));

  const seen = [first.rows[0], second.rows[0]].map((p) => p.nameEn).sort();
  assert.deepStrictEqual(seen, ['Amoxicillin', 'Paracetamol']);
});
