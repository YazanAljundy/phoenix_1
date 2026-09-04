// GET /warehouse/products/search - the advertisement product picker's backing
// query. The point of it is that a large catalog is searched *server-side*, a
// page at a time, instead of being downloaded whole and filtered in React.
//
// A product's name normally lives on its linked ProductCatalog entry
// (masterProductId), not on the product row, so these tests cover both the
// catalog-linked path and the legacy self-named path.
//
// Own database, dropped at the end.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-product-search-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-product-search-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Product = require('../src/models/product.model');
const ProductCatalog = require('../src/models/productCatalog.model');

const { searchPaginatedProductsForWarehouse } = require('../src/services/warehouseProduct.service');

const ids = {};

async function search(q, options = {}) {
  const { rows } = await searchPaginatedProductsForWarehouse(ids.warehouse, { q, limit: 50, ...options });
  return rows.map((p) => p.nameEn ?? p.nameAr);
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  const [whUser, otherWhUser] = await User.create([
    { name: 'WH', phone: '0942000501', role: 'warehouse', status: 'active' },
    { name: 'WH2', phone: '0942000502', role: 'warehouse', status: 'active' },
  ]);
  const [warehouse, otherWarehouse] = await Warehouse.create([
    { userId: whUser._id, nameAr: 'م', nameEn: 'Warehouse', address: 'r', city: 'Latakia', phone: '0942000501', deliveryType: 'self', isActive: true },
    { userId: otherWhUser._id, nameAr: 'م2', nameEn: 'Warehouse 2', address: 'r', city: 'Latakia', phone: '0942000502', deliveryType: 'self', isActive: true },
  ]);
  ids.warehouse = warehouse._id;
  ids.otherWarehouse = otherWarehouse._id;

  // Catalog-linked products: the name lives on the catalog entry only.
  const catalogEntries = await ProductCatalog.create([
    { nameAr: 'باراسيتامول', nameEn: 'Paracetamol', manufacturerAr: 'ابن الهيثم', manufacturerEn: 'Ibn Al Haytham', isActive: true },
    { nameAr: 'فيتامين سي', nameEn: 'Vitamin C', manufacturerAr: 'باريش', manufacturerEn: 'Barish', isActive: true },
    { nameAr: 'أموكسيسيلين', nameEn: 'Amoxicillin', manufacturerAr: 'ابن الهيثم', manufacturerEn: 'Ibn Al Haytham', isActive: true },
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

  // A legacy product that carries its own identity fields (pre catalog-link).
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

  // Deactivated - must never surface in the picker.
  const retired = await Product.create({
    warehouseId: ids.warehouse,
    nameEn: 'Retired Paracetamol',
    nameAr: 'باراسيتامول متوقف',
    price: 8,
    isActive: true,
  });
  await Product.updateOne({ _id: retired._id }, { isActive: false });

  // Another warehouse's product with a name that matches every search below.
  await Product.create({
    warehouseId: ids.otherWarehouse,
    nameEn: 'Paracetamol Foreign',
    nameAr: 'باراسيتامول أجنبي',
    price: 9,
    isAvailable: true,
    isActive: true,
  });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('searches by English product name', async () => {
  assert.deepStrictEqual(await search('Paracetamol'), ['Paracetamol']);
});

test('searches by Arabic product name', async () => {
  assert.deepStrictEqual(await search('باراسيتامول'), ['Paracetamol']);
});

test('English search is case-insensitive', async () => {
  assert.deepStrictEqual(await search('pArAcEtAmOl'), ['Paracetamol']);
});

test('a partial name matches', async () => {
  assert.deepStrictEqual((await search('amox')).sort(), ['Amoxicillin']);
});

test('searches by manufacturer, in either language', async () => {
  assert.deepStrictEqual((await search('Ibn Al Haytham')).sort(), ['Amoxicillin', 'Paracetamol']);
  assert.deepStrictEqual((await search('ابن الهيثم')).sort(), ['Amoxicillin', 'Paracetamol']);
});

test('finds a legacy product that carries its own name', async () => {
  assert.deepStrictEqual(await search('Syrup X'), ['Syrup X']);
  assert.deepStrictEqual(await search('شراب اكس'), ['Syrup X']);
});

test("never returns another warehouse's products", async () => {
  const names = await search('Paracetamol');
  assert.ok(!names.includes('Paracetamol Foreign'));
});

test('never returns a deactivated product', async () => {
  const names = await search('Paracetamol');
  assert.ok(!names.includes('Retired Paracetamol'));
});

test('a blank query returns this warehouse\'s active products', async () => {
  const names = await search('');
  assert.deepStrictEqual(names.sort(), ['Amoxicillin', 'Paracetamol', 'Syrup X', 'Vitamin C']);
});

test('a query matching nothing returns an empty page, not everything', async () => {
  assert.deepStrictEqual(await search('zzzzz-no-such-medicine'), []);
});

test('regex metacharacters in the query are treated literally', async () => {
  // Would match every product if the input were interpolated into the RegExp
  // unescaped.
  assert.deepStrictEqual(await search('.*'), []);
});

test('paginates with a cursor, no repeats and no gaps', async () => {
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 10; i += 1) {
    const page = await searchPaginatedProductsForWarehouse(ids.warehouse, { q: '', limit: 2, after: cursor });
    seen.push(...page.rows.map((p) => String(p._id)));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  assert.strictEqual(seen.length, 4);
  assert.strictEqual(new Set(seen).size, 4);
});

test('pagination applies to a filtered search too', async () => {
  const first = await searchPaginatedProductsForWarehouse(ids.warehouse, {
    q: 'Ibn Al Haytham',
    limit: 1,
  });
  assert.strictEqual(first.rows.length, 1);
  assert.strictEqual(first.hasMore, true);

  const second = await searchPaginatedProductsForWarehouse(ids.warehouse, {
    q: 'Ibn Al Haytham',
    limit: 1,
    after: first.nextCursor,
  });
  assert.strictEqual(second.rows.length, 1);
  assert.strictEqual(second.hasMore, false);
  assert.notStrictEqual(String(first.rows[0]._id), String(second.rows[0]._id));
});
