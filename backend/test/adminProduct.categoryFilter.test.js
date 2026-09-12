// Covers the categoryId filter added to the Admin Products and Admin Catalog
// management pages - both were searchable before but had no way to narrow by
// category despite Product/ProductCatalog already carrying categoryId.
//
// Runs against its own database (feniq-admin-category-test) and drops it at
// the end, same pattern as catalog.search.test.js.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-admin-category-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const ProductCatalog = require('../src/models/productCatalog.model');

const adminProductService = require('../src/services/adminProduct.service');
const catalogService = require('../src/services/productCatalog.service');

const ids = {};

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-admin-category-test' });

  const warehouseUser = await User.create({
    name: 'WH', phone: '0940000001', role: 'warehouse', status: 'active',
  });
  const warehouse = await Warehouse.create({
    userId: warehouseUser._id, nameAr: 'م', nameEn: 'W',
    address: 'addr', city: 'Latakia', phone: '0940000001', isActive: true,
  });
  ids.warehouseId = warehouse._id;

  const [painkillers, vitamins] = await Category.create([
    { nameAr: 'مسكنات', nameEn: 'Painkillers' },
    { nameAr: 'فيتامينات', nameEn: 'Vitamins' },
  ]);
  ids.painkillers = painkillers._id;
  ids.vitamins = vitamins._id;

  const [panadolCatalog, vitaminCCatalog, uncategorizedCatalog] = await ProductCatalog.create([
    { nameAr: 'بانادول', nameEn: 'Panadol', manufacturerAr: 'جي اس كي', manufacturerEn: 'GSK', categoryId: painkillers._id },
    { nameAr: 'فيتامين سي', nameEn: 'Vitamin C', manufacturerAr: 'باير', manufacturerEn: 'Bayer', categoryId: vitamins._id },
    { nameAr: 'غير مصنّف', nameEn: 'Uncategorized', manufacturerAr: 'اخرى', manufacturerEn: 'Other' },
  ]);
  ids.panadolCatalog = panadolCatalog._id;
  ids.vitaminCCatalog = vitaminCCatalog._id;
  ids.uncategorizedCatalog = uncategorizedCatalog._id;

  await Product.create([
    // Catalog-linked painkiller.
    { warehouseId: warehouse._id, masterProductId: panadolCatalog._id, categoryId: painkillers._id, price: 5 },
    // Catalog-linked vitamin.
    { warehouseId: warehouse._id, masterProductId: vitaminCCatalog._id, categoryId: vitamins._id, price: 6 },
    // Legacy product, own categoryId, no catalog link.
    {
      warehouseId: warehouse._id, masterProductId: null, categoryId: painkillers._id, price: 7,
      nameAr: 'مسكن قديم', nameEn: 'Legacy Painkiller', manufacturerAr: 'قديم', manufacturerEn: 'Legacy',
    },
    // No category at all.
    {
      warehouseId: warehouse._id, masterProductId: null, categoryId: null, price: 8,
      nameAr: 'غير مصنف', nameEn: 'No Category', manufacturerAr: 'اخرى', manufacturerEn: 'Other',
    },
  ]);
});

test.after(async () => {
  await stopMemoryMongo();
});

test('adminProduct.service: categoryId filters to only that category\'s products', async () => {
  const { rows } = await adminProductService.listPaginatedAllProducts({
    categoryId: ids.painkillers.toString(),
    limit: 50,
  });
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => String(r.product.categoryId) === String(ids.painkillers)));
  const names = rows.map((r) => r.product.nameEn).sort();
  assert.deepStrictEqual(names, ['Legacy Painkiller', 'Panadol']);
});

test('adminProduct.service: no categoryId returns every product regardless of category', async () => {
  const { rows } = await adminProductService.listPaginatedAllProducts({ limit: 50 });
  assert.strictEqual(rows.length, 4);
});

test('adminProduct.service: categoryId combines with warehouseId (both narrow the result)', async () => {
  const { rows } = await adminProductService.listPaginatedAllProducts({
    warehouseId: ids.warehouseId.toString(),
    categoryId: ids.vitamins.toString(),
    limit: 50,
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].product.nameEn, 'Vitamin C');
});

test('adminProduct.service: an unused categoryId returns an empty page, not an error', async () => {
  const unusedCategoryId = new mongoose.Types.ObjectId().toString();
  const { rows } = await adminProductService.listPaginatedAllProducts({ categoryId: unusedCategoryId, limit: 50 });
  assert.deepStrictEqual(rows, []);
});

test('productCatalog.service: categoryId filters the central catalog the same way', async () => {
  const { items } = await catalogService.listCatalog({ categoryId: ids.vitamins.toString(), limit: 50 });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(String(items[0]._id), String(ids.vitaminCCatalog));
});

test('productCatalog.service: categoryId and search combine (both must match)', async () => {
  const { items } = await catalogService.listCatalog({
    categoryId: ids.painkillers.toString(),
    search: 'Panadol',
    limit: 50,
  });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(String(items[0]._id), String(ids.panadolCatalog));

  // Same search term, wrong category -> no match.
  const wrongCategory = await catalogService.listCatalog({
    categoryId: ids.vitamins.toString(),
    search: 'Panadol',
    limit: 50,
  });
  assert.deepStrictEqual(wrongCategory.items, []);
});

test('productCatalog.service: an uncategorized entry is only visible with no categoryId filter', async () => {
  const all = await catalogService.listCatalog({ limit: 50 });
  assert.ok(all.items.some((i) => String(i._id) === String(ids.uncategorizedCatalog)));

  const filtered = await catalogService.listCatalog({ categoryId: ids.painkillers.toString(), limit: 50 });
  assert.ok(!filtered.items.some((i) => String(i._id) === String(ids.uncategorizedCatalog)));
});
