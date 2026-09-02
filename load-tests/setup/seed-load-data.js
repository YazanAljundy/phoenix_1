/**
 * Load-test fixture seeder. Writes ONLY clearly-marked load-test documents
 * into the LOCAL phoenix database and never touches, reads back, or mutates
 * any pre-existing record.
 *
 * Everything it creates is identifiable two ways, so cleanup is exact:
 *   - users.phone starts with LT_PHONE_PREFIX ('0977')
 *   - every document carries `loadTestTag: 'phoenix-load-test'`
 *
 *   node setup/seed-load-data.js            seed
 *   node setup/seed-load-data.js --clean    remove every tagged document
 *   node setup/seed-load-data.js --report   count tagged documents only
 *
 * No application code is imported - only the driver and bcrypt, resolved out
 * of the backend's own node_modules. The documents are shaped to match the
 * Mongoose schemas exactly.
 */
const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..', '..', 'backend');
const { MongoClient, ObjectId } = require(require.resolve('mongodb', { paths: [backendDir] }));
const bcrypt = require(require.resolve('bcrypt', { paths: [backendDir] }));

const TAG = 'phoenix-load-test';
const LT_PHONE_PREFIX = '0977';
const MONGO_URI = process.env.LOAD_TEST_MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.LOAD_TEST_DB || 'phoenix';

// Sizing. Each pharmacy account is one simulated logged-in user; k6 VUs are
// spread across them round-robin.
const PHARMACY_COUNT = Number(process.env.LT_PHARMACIES || 500);
// Warehouse-role accounts exist only for Socket.IO: the realtime handshake
// refuses role 'pharmacy' outright (realtime/index.js, resolveRoomsFor), so a
// socket test needs warehouse or admin accounts - one room each.
const SOCKET_WAREHOUSE_COUNT = Number(process.env.LT_SOCKET_WAREHOUSES || 25);
// Three catalog sizes, so the O(catalog) read paths can be measured against
// catalog size and not only against concurrency.
const CATALOG_SIZES = [200, 1000, 5000];
// Delivered orders give the review/return write scenarios a supply of valid,
// not-yet-used targets (one review and one return per order, ever).
const DELIVERED_ORDERS_PER_PHARMACY = Number(process.env.LT_DELIVERED_ORDERS || 12);

const OUT_PATH = path.join(__dirname, '..', '.runtime', 'load-fixtures.json');

const MANUFACTURERS = [
  'Manufacturer Alpha', 'Manufacturer Beta', 'Manufacturer Gamma', 'Manufacturer Delta',
  'Manufacturer Epsilon', 'Manufacturer Zeta', 'Manufacturer Eta', 'Manufacturer Theta',
  'Manufacturer Iota', 'Manufacturer Kappa',
];

function ltPhone(index) {
  // users.phone must satisfy /^(?:\+963|0)9\d{8}$/ - 10 chars, '09' + 8 digits.
  return LT_PHONE_PREFIX + String(index).padStart(6, '0');
}

function assertLocal(uri) {
  const host = uri.replace(/^mongodb(\+srv)?:\/\//, '').split('/')[0];
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!isLocal && process.env.ALLOW_PROTECTED_TARGET !== 'true') {
    throw new Error(
      'Refusing to seed non-local MongoDB host "' + host + '". ' +
      'Load-test fixtures are only ever written to a local/disposable database.'
    );
  }
}

const TAGGED_COLLECTIONS = [
  'users', 'pharmacies', 'warehouses', 'products', 'orders', 'orderitems',
  'returns', 'reviews', 'notifications',
];

async function report(db) {
  const rows = {};
  for (const name of TAGGED_COLLECTIONS) {
    rows[name] = await db.collection(name).countDocuments({ loadTestTag: TAG });
  }
  return rows;
}

// Documents the write scenarios create go through the real API, so they never
// carry loadTestTag - the application does not know about it. They are still
// exactly identifiable by ownership: every one of them belongs to a fixture
// pharmacy or fixture warehouse, both of which ARE tagged. Deleting by those
// ids is what makes cleanup complete without ever touching a real record.
async function derivedCleanup(db) {
  const pharmacyIds = (await db.collection('pharmacies')
    .find({ loadTestTag: TAG }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const warehouseIds = (await db.collection('warehouses')
    .find({ loadTestTag: TAG }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  const userIds = (await db.collection('users')
    .find({ loadTestTag: TAG }, { projection: { _id: 1 } }).toArray()).map((d) => d._id);

  const deleted = {};
  if (pharmacyIds.length || warehouseIds.length) {
    const ownerFilter = {
      $or: [
        ...(pharmacyIds.length ? [{ pharmacyId: { $in: pharmacyIds } }] : []),
        ...(warehouseIds.length ? [{ warehouseId: { $in: warehouseIds } }] : []),
      ],
    };
    // Order items are reached through their order, which has no pharmacyId of
    // its own on the item document.
    const orderIds = (await db.collection('orders')
      .find(ownerFilter, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    deleted.orderitems_derived = orderIds.length
      ? (await db.collection('orderitems').deleteMany({ orderId: { $in: orderIds } })).deletedCount
      : 0;
    for (const name of ['orders', 'returns', 'reviews', 'payments', 'pharmacybalances']) {
      deleted[name + '_derived'] = (await db.collection(name).deleteMany(ownerFilter)).deletedCount;
    }
  }
  if (userIds.length) {
    deleted.notifications_derived =
      (await db.collection('notifications').deleteMany({ userId: { $in: userIds } })).deletedCount;
  }
  return deleted;
}

async function clean(db) {
  const before = await report(db);
  // Derived documents first: they are found through the tagged parents, which
  // the tagged pass below then removes.
  const derived = await derivedCleanup(db);
  const deleted = {};
  for (const name of TAGGED_COLLECTIONS) {
    const result = await db.collection(name).deleteMany({ loadTestTag: TAG });
    deleted[name] = result.deletedCount;
  }
  return { before, deleted: { ...deleted, ...derived } };
}

async function seed(db) {
  const now = new Date();
  const password = process.env.LT_PASSWORD || 'LoadTest!2026';
  // One hash reused across every fixture account: bcrypt embeds its salt in
  // the hash, so a single hash verifies the same password for all of them.
  // Hashing 500 times here would add minutes of seeding for no test value.
  const passwordHash = await bcrypt.hash(password, 10);

  const users = [];
  const pharmacies = [];
  const warehouses = [];
  const products = [];

  // ---- pharmacy accounts -------------------------------------------------
  for (let i = 0; i < PHARMACY_COUNT; i += 1) {
    const userId = new ObjectId();
    const phone = ltPhone(i);
    users.push({
      _id: userId,
      name: '[LOADTEST] Pharmacy ' + i,
      phone,
      password: passwordHash,
      role: 'pharmacy',
      status: 'active',
      lang: 'ar',
      deviceTokens: [],
      loadTestTag: TAG,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    pharmacies.push({
      _id: new ObjectId(),
      userId,
      nameAr: '[LOADTEST] Pharmacy ' + i,
      nameEn: '[LOADTEST] Pharmacy ' + i,
      ownerName: '[LOADTEST] Owner ' + i,
      address: 'Load-test fixture address',
      city: 'Latakia',
      phone,
      verificationPhoto: null,
      licenseNumber: null,
      licenseImage: null,
      addedBy: 'self',
      averageRating: 0,
      reviewsCount: 0,
      isActive: true,
      loadTestTag: TAG,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
  }

  // ---- catalog warehouses (visible; used by read + order scenarios) ------
  const catalogWarehouses = [];
  CATALOG_SIZES.forEach((size, index) => {
    const userId = new ObjectId();
    const warehouseId = new ObjectId();
    const phone = ltPhone(900000 + index);
    users.push({
      _id: userId,
      name: '[LOADTEST] Warehouse ' + size,
      phone,
      password: passwordHash,
      role: 'warehouse',
      status: 'active',
      lang: 'ar',
      deviceTokens: [],
      loadTestTag: TAG,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    warehouses.push({
      _id: warehouseId,
      userId,
      nameAr: '[LOADTEST] Warehouse ' + size,
      nameEn: '[LOADTEST] Warehouse ' + size,
      address: 'Load-test fixture address',
      city: 'Latakia',
      phone,
      logo: null,
      discountRate: 4,
      commissionRate: 1,
      deliveryStartTime: null,
      deliveryEndTime: null,
      inventoryUpdateTime: null,
      averageRating: 0,
      reviewsCount: 0,
      deliveryType: 'self',
      minOrderAmountUsd: 0,
      maxOrderAmountUsd: null,
      isActive: true,
      loadTestTag: TAG,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    catalogWarehouses.push({ warehouseId, userId, size, phone });

    // Legacy-shaped products (masterProductId null): identity then resolves
    // from the product's own fields, exactly like the legacy rows already in
    // this database, without inventing ProductCatalog entries.
    for (let p = 0; p < size; p += 1) {
      products.push({
        _id: new ObjectId(),
        warehouseId,
        categoryId: null,
        masterProductId: null,
        nameAr: '[LOADTEST] Medicine ' + size + '-' + p,
        nameEn: '[LOADTEST] Medicine ' + size + '-' + p,
        manufacturerAr: MANUFACTURERS[p % MANUFACTURERS.length],
        manufacturerEn: MANUFACTURERS[p % MANUFACTURERS.length],
        description: null,
        barcode: null,
        image: null,
        price: Number((1 + (p % 400) / 10).toFixed(2)),
        isAvailable: true,
        manuallyDisabled: false,
        unitAr: 'Box',
        unitEn: 'Box',
        isActive: true,
        lastPriceUpdate: now,
        priceHistory: [],
        loadTestTag: TAG,
        createdAt: now,
        updatedAt: now,
        __v: 0,
      });
    }
  });

  // ---- socket-only warehouses (hidden from the pharmacist catalog) -------
  // isActive:false keeps them out of GET /warehouses (warehouse.service.js
  // filters on it) while the Socket.IO handshake still resolves a room for
  // them, since that path only looks the warehouse up by userId.
  const socketWarehouses = [];
  for (let i = 0; i < SOCKET_WAREHOUSE_COUNT; i += 1) {
    const userId = new ObjectId();
    const warehouseId = new ObjectId();
    const phone = ltPhone(910000 + i);
    users.push({
      _id: userId,
      name: '[LOADTEST] Socket Warehouse ' + i,
      phone,
      password: passwordHash,
      role: 'warehouse',
      status: 'active',
      lang: 'ar',
      deviceTokens: [],
      loadTestTag: TAG,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    warehouses.push({
      _id: warehouseId,
      userId,
      nameAr: '[LOADTEST] Socket Warehouse ' + i,
      nameEn: '[LOADTEST] Socket Warehouse ' + i,
      address: 'Load-test fixture address',
      city: 'Latakia',
      phone,
      logo: null,
      discountRate: 4,
      commissionRate: 1,
      deliveryStartTime: null,
      deliveryEndTime: null,
      inventoryUpdateTime: null,
      averageRating: 0,
      reviewsCount: 0,
      deliveryType: 'self',
      minOrderAmountUsd: 0,
      maxOrderAmountUsd: null,
      isActive: false,
      loadTestTag: TAG,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    socketWarehouses.push({ warehouseId, userId, phone });
  }

  await db.collection('users').insertMany(users, { ordered: false });
  await db.collection('pharmacies').insertMany(pharmacies, { ordered: false });
  await db.collection('warehouses').insertMany(warehouses, { ordered: false });
  for (let i = 0; i < products.length; i += 2000) {
    await db.collection('products').insertMany(products.slice(i, i + 2000), { ordered: false });
  }

  // ---- delivered orders --------------------------------------------------
  // Targets for the review and return write scenarios: status 'delivered',
  // with a statusHistory 'delivered' entry inside the 48h return window
  // (return.service.js anchors that window to the entry, not to updatedAt).
  const orderWarehouse = catalogWarehouses[0];
  const orderProducts = products
    .filter((p) => String(p.warehouseId) === String(orderWarehouse.warehouseId))
    .slice(0, 50);

  // orderNumber is uniquely indexed and application orders are allocated from
  // the `counters` document. Fixtures are numbered from a high, disjoint base
  // so they can never collide with a number the application hands out.
  const ORDER_NUMBER_BASE = 900000000;
  const orders = [];
  const orderItems = [];
  let orderSeq = 0;
  const deliveredAt = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago: inside the 48h window
  for (const pharmacy of pharmacies) {
    for (let k = 0; k < DELIVERED_ORDERS_PER_PHARMACY; k += 1) {
      const orderId = new ObjectId();
      const product = orderProducts[(orderSeq + k) % orderProducts.length];
      const unitPrice = Math.round(product.price * 130);
      orders.push({
        _id: orderId,
        orderNumber: ORDER_NUMBER_BASE + orderSeq,
        pharmacyId: pharmacy._id,
        warehouseId: orderWarehouse.warehouseId,
        status: 'delivered',
        totalPrice: unitPrice * 2,
        discountAmount: 0,
        commissionAmount: 0,
        finalPrice: unitPrice * 2,
        notes: '[LOADTEST] fixture order',
        cancelledBy: null,
        cancelReason: null,
        statusHistory: [
          { status: 'pending', changedBy: pharmacy.userId, changedAt: deliveredAt, note: null },
          { status: 'delivered', changedBy: pharmacy.userId, changedAt: deliveredAt, note: null },
        ],
        loadTestTag: TAG,
        createdAt: deliveredAt,
        updatedAt: deliveredAt,
        __v: 0,
      });
      orderItems.push({
        _id: new ObjectId(),
        orderId,
        productId: product._id,
        productNameAr: product.nameAr,
        productNameEn: product.nameEn,
        manufacturerAr: product.manufacturerAr,
        manufacturerEn: product.manufacturerEn,
        quantity: 2,
        unitPrice,
        discountPrice: unitPrice,
        savingsUsd: 0,
        loadTestTag: TAG,
        createdAt: deliveredAt,
        updatedAt: deliveredAt,
        __v: 0,
      });
      orderSeq += 1;
    }
  }
  for (let i = 0; i < orders.length; i += 2000) {
    await db.collection('orders').insertMany(orders.slice(i, i + 2000), { ordered: false });
  }
  for (let i = 0; i < orderItems.length; i += 2000) {
    await db.collection('orderitems').insertMany(orderItems.slice(i, i + 2000), { ordered: false });
  }

  // ---- runtime manifest for the k6 scripts -------------------------------
  const fixtures = {
    tag: TAG,
    createdAt: now.toISOString(),
    baseUrl: process.env.BASE_URL || 'http://localhost:5000/api',
    password,
    pharmacyPhones: pharmacies.map((p) => p.phone),
    // Per-pharmacy delivered order ids, so a write VU always picks a target
    // that belongs to the account it is authenticated as.
    deliveredOrdersByPhone: Object.fromEntries(
      pharmacies.map((pharmacy, index) => [
        pharmacy.phone,
        orders
          .slice(index * DELIVERED_ORDERS_PER_PHARMACY, (index + 1) * DELIVERED_ORDERS_PER_PHARMACY)
          .map((o) => String(o._id)),
      ])
    ),
    catalogWarehouses: catalogWarehouses.map((w) => ({
      id: String(w.warehouseId),
      size: w.size,
      phone: w.phone,
    })),
    socketWarehousePhones: socketWarehouses.map((w) => w.phone),
    orderTargetWarehouseId: String(orderWarehouse.warehouseId),
    orderTargetProductIds: orderProducts.map((p) => String(p._id)),
    counts: {
      users: users.length,
      pharmacies: pharmacies.length,
      warehouses: warehouses.length,
      products: products.length,
      orders: orders.length,
      orderItems: orderItems.length,
    },
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(fixtures, null, 2));
  return fixtures;
}

async function main() {
  assertLocal(MONGO_URI);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  try {
    if (process.argv.includes('--report')) {
      console.log(JSON.stringify(await report(db), null, 2));
      return;
    }
    if (process.argv.includes('--clean')) {
      const result = await clean(db);
      console.log('[seed] removed tagged fixtures: ' + JSON.stringify(result.deleted));
      if (fs.existsSync(OUT_PATH)) fs.unlinkSync(OUT_PATH);
      return;
    }
    const existing = await report(db);
    if (Object.values(existing).some((n) => n > 0)) {
      throw new Error(
        'Fixtures already present (' + JSON.stringify(existing) + '). Run with --clean first.'
      );
    }
    const fixtures = await seed(db);
    console.log('[seed] created: ' + JSON.stringify(fixtures.counts));
    console.log('[seed] manifest: ' + OUT_PATH);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('[seed] FAILED: ' + error.message);
  process.exitCode = 1;
});
