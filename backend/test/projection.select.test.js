// Regression tests for the Level 1 `.select()` projections applied across the
// backend read paths (see backend/docs/PERFORMANCE_OPTIMIZATION.md).
//
// A too-narrow projection does not throw - it silently yields `undefined` for
// the missing field, which then flows into the API response. These tests pin
// the viewmodel output of every list/detail endpoint whose backing query was
// projected, so a dropped-but-needed field fails loudly here rather than in
// production.
//
// Runs against its own database and drops it at the end - same pattern as
// readpath.lean.test.js / catalog.search.test.js.
process.env.MONGODB_URI = 'mongodb://localhost:27017/phoenix-projection-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-projection-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const Pharmacy = require('../src/models/pharmacy.model');
const Warehouse = require('../src/models/warehouse.model');
const Category = require('../src/models/category.model');
const ProductCatalog = require('../src/models/productCatalog.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const OrderItem = require('../src/models/orderItem.model');
const Review = require('../src/models/review.model');
const Return = require('../src/models/return.model');
const Offer = require('../src/models/offer.model');
const Banner = require('../src/models/banner.model');
const Payment = require('../src/models/payment.model');
const PharmacyBalance = require('../src/models/pharmacyBalance.model');
const ManufacturerDiscount = require('../src/models/manufacturerDiscount.model');

const adminService = require('../src/services/admin.service');
const adminViewModel = require('../src/viewmodels/admin.viewmodel');
const orderService = require('../src/services/order.service');
const orderViewModel = require('../src/viewmodels/order.viewmodel');
const warehouseOrderService = require('../src/services/warehouseOrder.service');
const warehouseOrderViewModel = require('../src/viewmodels/warehouseOrder.viewmodel');
const reviewService = require('../src/services/review.service');
const reviewViewModel = require('../src/viewmodels/review.viewmodel');
const warehouseReviewService = require('../src/services/warehouseReview.service');
const warehouseReviewViewModel = require('../src/viewmodels/warehouseReview.viewmodel');
const warehouseService = require('../src/services/warehouse.service');
const warehouseViewModel = require('../src/viewmodels/warehouse.viewmodel');
const returnServiceModule = require('../src/services/return.service');
const returnViewModel = require('../src/viewmodels/return.viewmodel');
const warehouseReturnService = require('../src/services/warehouseReturn.service');
const warehouseReturnViewModel = require('../src/viewmodels/warehouseReturn.viewmodel');
const warehouseOfferService = require('../src/services/warehouseOffer.service');
const warehouseOfferViewModel = require('../src/viewmodels/warehouseOffer.viewmodel');
const adminOfferService = require('../src/services/adminOffer.service');
const adminOfferViewModel = require('../src/viewmodels/adminOffer.viewmodel');
const discountService = require('../src/services/manufacturerDiscount.service');
const discountViewModel = require('../src/viewmodels/manufacturerDiscount.viewmodel');
const bannerService = require('../src/services/banner.service');
const bannerViewModel = require('../src/viewmodels/banner.viewmodel');
const adminBannerService = require('../src/services/adminBanner.service');
const adminBannerViewModel = require('../src/viewmodels/adminBanner.viewmodel');
const warehouseBannerService = require('../src/services/warehouseBanner.service');
const warehouseBannerViewModel = require('../src/viewmodels/warehouseBanner.viewmodel');
const balanceService = require('../src/services/pharmacyBalance.service');
const balanceViewModel = require('../src/viewmodels/pharmacyBalance.viewmodel');

const ids = {
  pharmUser: new mongoose.Types.ObjectId(),
  whUser: new mongoose.Types.ObjectId(),
  pendingPharmUser: new mongoose.Types.ObjectId(),
  pendingWhUser: new mongoose.Types.ObjectId(),
  pharmacy: new mongoose.Types.ObjectId(),
  warehouse: new mongoose.Types.ObjectId(),
  pendingPharmacy: new mongoose.Types.ObjectId(),
  pendingWarehouse: new mongoose.Types.ObjectId(),
  category: new mongoose.Types.ObjectId(),
  catalog: new mongoose.Types.ObjectId(),
  product: new mongoose.Types.ObjectId(),
  order: new mongoose.Types.ObjectId(),
  orderItem: new mongoose.Types.ObjectId(),
};

// Recent enough that the 48-hour return window is still open.
const DELIVERED_AT = new Date(Date.now() - 60 * 60 * 1000);

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();

  await User.create([
    { _id: ids.pharmUser, name: 'Pharm Owner', phone: '0930000001', role: 'pharmacy', status: 'active' },
    { _id: ids.whUser, name: 'WH Owner', phone: '0930000002', role: 'warehouse', status: 'active' },
    { _id: ids.pendingPharmUser, name: 'Pending Pharm', phone: '0930000003', role: 'pharmacy', status: 'pending' },
    { _id: ids.pendingWhUser, name: 'Pending WH', phone: '0930000004', role: 'warehouse', status: 'pending' },
  ]);

  await Pharmacy.create([
    {
      _id: ids.pharmacy, userId: ids.pharmUser, nameAr: 'صيدلية', nameEn: 'Pharmacy One',
      ownerName: 'Pharm Owner', address: '1 St', city: 'Latakia', phone: '0930000001', addedBy: 'self',
      verificationPhoto: 'https://x/verif.jpg',
    },
    {
      _id: ids.pendingPharmacy, userId: ids.pendingPharmUser, nameAr: 'صيدلية ٢', nameEn: 'Pharmacy Pending',
      ownerName: 'Pending Pharm', address: '2 St', city: 'Latakia', phone: '0930000003', addedBy: 'self',
    },
  ]);

  await Warehouse.create([
    {
      _id: ids.warehouse, userId: ids.whUser, nameAr: 'مستودع', nameEn: 'Warehouse One',
      address: '9 Rd', city: 'Latakia', phone: '0930000002', logo: 'https://x/logo.png',
      deliveryStartTime: '08:00', deliveryEndTime: '17:00', deliveryType: 'self',
      discountRate: 4, commissionRate: 1, minOrderAmountUsd: 10, maxOrderAmountUsd: 900, isActive: true,
    },
    {
      _id: ids.pendingWarehouse, userId: ids.pendingWhUser, nameAr: 'مستودع ٢', nameEn: 'Warehouse Pending',
      address: '3 Rd', city: 'Latakia', phone: '0930000004', isActive: true,
    },
  ]);

  await Category.create({ _id: ids.category, nameAr: 'ف', nameEn: 'Cat', icon: 'i', sortOrder: 1 });
  await ProductCatalog.create({
    _id: ids.catalog, nameAr: 'دواء', nameEn: 'Med', manufacturerAr: 'شركة', manufacturerEn: 'Co',
  });
  await Product.create({
    _id: ids.product, warehouseId: ids.warehouse, masterProductId: ids.catalog, categoryId: ids.category,
    unitAr: 'علبة', unitEn: 'box', price: 12, isAvailable: true, isActive: true,
  });

  await Offer.create({
    warehouseId: ids.warehouse, productId: ids.product, titleAr: 'خصم', titleEn: 'Sale',
    discountPercentage: 10, startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'),
    status: 'approved',
  });

  await ManufacturerDiscount.create({
    warehouseId: ids.warehouse, manufacturerAr: 'شركة', discountPercentage: 5,
  });

  await Order.create({
    _id: ids.order, orderNumber: 5001, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    status: 'delivered', totalPrice: 1000, discountAmount: 40, commissionAmount: 10, finalPrice: 960,
    notes: 'leave at door',
    statusHistory: [
      { status: 'pending', changedBy: ids.pharmUser, changedAt: new Date(DELIVERED_AT.getTime() - 3600000) },
      { status: 'delivered', changedBy: ids.whUser, changedAt: DELIVERED_AT },
    ],
  });
  await OrderItem.create({
    _id: ids.orderItem, orderId: ids.order, productId: ids.product,
    productNameAr: 'دواء', productNameEn: 'Med', manufacturerAr: 'شركة', manufacturerEn: 'Co',
    quantity: 3, unitPrice: 400, discountPrice: 320, savingsUsd: 2.4,
  });

  await Review.create([
    {
      orderId: ids.order, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
      reviewerType: 'pharmacy', rating: 5, comment: 'great', isVisible: true,
    },
    {
      orderId: ids.order, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
      reviewerType: 'warehouse', rating: 4, comment: 'ok', isVisible: true,
    },
  ]);

  await Return.create({
    orderId: ids.order, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ orderItemId: ids.orderItem, productId: ids.product, quantity: 1, reasonType: 'damaged' }],
    notes: 'broken seal', images: ['https://x/r.jpg'], status: 'pending',
  });

  await Banner.create({
    bannerNumber: 700, warehouseId: ids.warehouse, imageUrl: 'https://x/b.jpg', productId: ids.product,
    manufacturerAr: 'شركة', title: 'Promo', status: 'approved',
    startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'), createdBy: ids.whUser,
  });

  await Payment.create({
    pharmacyId: ids.pharmacy, warehouseId: ids.warehouse, amount: 100, currency: 'USD',
    recordedBy: ids.whUser,
  });
  await PharmacyBalance.create({
    pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    totalOrdersUsd: 300, totalPaidUsd: 100, balanceUsd: 200,
  });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// --- admin pending accounts ------------------------------------------------

test('admin pending-accounts response keeps every serialised field', async () => {
  const items = await adminService.listPendingAccounts();
  const { accounts } = adminViewModel.toPendingAccountsResponse(items);
  assert.strictEqual(accounts.length, 2);

  const pharmRow = accounts.find((a) => a.user.role === 'pharmacy');
  assert.deepStrictEqual(Object.keys(pharmRow.user).sort(), ['id', 'lang', 'name', 'phone', 'role', 'status'].sort());
  assert.strictEqual(pharmRow.user.name, 'Pending Pharm');
  assert.strictEqual(pharmRow.user.lang, 'ar');
  assert.deepStrictEqual(
    Object.keys(pharmRow.pharmacy).sort(),
    ['id', 'nameAr', 'nameEn', 'ownerName', 'address', 'city', 'phone', 'verificationPhoto'].sort()
  );
  assert.strictEqual(pharmRow.pharmacy.nameEn, 'Pharmacy Pending');
  assert.strictEqual(pharmRow.warehouse, null);

  const whRow = accounts.find((a) => a.user.role === 'warehouse');
  assert.deepStrictEqual(
    Object.keys(whRow.warehouse).sort(),
    ['id', 'nameAr', 'nameEn', 'city', 'phone', 'logo'].sort()
  );
  assert.strictEqual(whRow.warehouse.nameEn, 'Warehouse Pending');
});

test('admin paginated pending-accounts response is equally complete', async () => {
  const { rows } = await adminService.listPaginatedPendingAccounts('pharmacy', { limit: 10 });
  const { accounts } = adminViewModel.toPendingAccountsResponse(rows);
  assert.strictEqual(accounts.length, 1);
  assert.strictEqual(accounts[0].pharmacy.ownerName, 'Pending Pharm');
  assert.strictEqual(accounts[0].pharmacy.verificationPhoto, null);
  assert.strictEqual(accounts[0].user.phone, '0930000003');
});

// --- pharmacy orders -----------------------------------------------------

test('pharmacy order list row carries all pricing + warehouse names', async () => {
  const { rows } = await orderService.listOrdersForPharmacy(ids.pharmacy, {});
  const { orders } = orderViewModel.toOrderListResponse(rows);
  assert.strictEqual(orders.length, 1);
  const o = orders[0];
  assert.deepStrictEqual(
    Object.keys(o).sort(),
    ['id', 'orderNumber', 'status', 'totalPrice', 'discountAmount', 'commissionAmount',
      // The advertisement package discount rides along as its own pair on
      // every order row - null/0 for an order that didn't come from one, as
      // this fixture's order didn't.
      'advertisementId', 'advertisementDiscountAmount',
      'finalPrice', 'warehouseNameAr', 'warehouseNameEn', 'createdAt'].sort()
  );
  assert.strictEqual(o.orderNumber, 5001);
  assert.strictEqual(o.advertisementId, null);
  assert.strictEqual(o.advertisementDiscountAmount, 0);
  assert.strictEqual(o.finalPrice, 960);
  assert.strictEqual(o.commissionAmount, 10);
  assert.strictEqual(o.warehouseNameEn, 'Warehouse One');
});

test('pharmacy order detail keeps warehouse/items/return/review fields', async () => {
  const { order, warehouse, items, returnRequest, myReview } =
    await orderService.getOrderForPharmacy(String(ids.order), ids.pharmacy);
  const payload = orderViewModel.toOrderDetailResponse(order, warehouse, items, returnRequest, myReview);
  const d = payload.order;
  assert.strictEqual(d.warehouseNameEn, 'Warehouse One');
  assert.strictEqual(d.orderNumber, 5001);
  assert.strictEqual(d.notes, 'leave at door');
  assert.strictEqual(d.statusHistory.length, 2);
  assert.strictEqual(d.items.length, 1);
  assert.deepStrictEqual(
    Object.keys(d.items[0]).sort(),
    ['id', 'productId', 'productNameAr', 'productNameEn', 'manufacturerAr', 'manufacturerEn',
      'quantity', 'unitPrice', 'discountPrice', 'lineTotal', 'savingsUsd'].sort()
  );
  assert.strictEqual(d.items[0].savingsUsd, 2.4);
  assert.strictEqual(d.items[0].lineTotal, 320 * 3);
  assert.strictEqual(d.linkedReturn.status, 'pending');
  assert.strictEqual(d.myReview.rating, 5);
  assert.strictEqual(d.myReview.comment, 'great');
});

test('returnable-orders response keeps order + item fields', async () => {
  const rows = await orderService.listReturnableOrders(ids.pharmacy);
  const { orders } = orderViewModel.toReturnableOrdersResponse(rows);
  // The fixture order already has a Return, so it is excluded - assert the
  // path runs and stays empty rather than erroring on a projected field.
  assert.deepStrictEqual(orders, []);

  // Drop the return and it must resurface, fully shaped.
  await Return.deleteMany({ orderId: ids.order });
  const rows2 = await orderService.listReturnableOrders(ids.pharmacy);
  const { orders: orders2 } = orderViewModel.toReturnableOrdersResponse(rows2);
  assert.strictEqual(orders2.length, 1);
  assert.strictEqual(orders2[0].orderNumber, 5001);
  assert.strictEqual(orders2[0].finalPrice, 960);
  assert.strictEqual(orders2[0].warehouseNameEn, 'Warehouse One');
  assert.strictEqual(orders2[0].items[0].productNameEn, 'Med');
  assert.strictEqual(orders2[0].items[0].discountPrice, 320);
  assert.ok(orders2[0].deliveredAt, 'deliveredAt is derived from statusHistory - which must be selected');

  await Return.create({
    orderId: ids.order, pharmacyId: ids.pharmacy, warehouseId: ids.warehouse,
    items: [{ orderItemId: ids.orderItem, productId: ids.product, quantity: 1, reasonType: 'damaged' }],
    notes: 'broken seal', images: ['https://x/r.jpg'], status: 'pending',
  });
});

// --- warehouse orders --------------------------------------------------

test('warehouse order list row keeps order + pharmacy + item fields', async () => {
  const { rows } = await warehouseOrderService.listOrdersForWarehouse(ids.warehouse, null, {});
  const { orders } = warehouseOrderViewModel.toWarehouseOrdersResponse(rows);
  assert.strictEqual(orders.length, 1);
  const o = orders[0];
  assert.strictEqual(o.orderNumber, 5001);
  assert.strictEqual(o.finalPrice, 960);
  assert.strictEqual(o.notes, 'leave at door');
  assert.strictEqual(o.pharmacy.nameEn, 'Pharmacy One');
  assert.strictEqual(o.pharmacy.ownerName, 'Pharm Owner');
  assert.strictEqual(o.pharmacy.phone, '0930000001');
  assert.strictEqual(o.items[0].productNameEn, 'Med');
  assert.strictEqual(o.items[0].unitPrice, 400);
  assert.strictEqual(o.hasReviewed, true);
});

test('warehouse order detail keeps every field its viewmodel emits', async () => {
  const data = await warehouseOrderService.getOrderDetailForWarehouse(String(ids.order), ids.warehouse);
  const payload = warehouseOrderViewModel.toWarehouseOrderDetailResponse(data);
  const d = payload.order;
  assert.strictEqual(d.orderNumber, 5001);
  assert.strictEqual(d.totalPrice, 1000);
  assert.strictEqual(d.discountAmount, 40);
  assert.strictEqual(d.commissionAmount, 10);
  assert.strictEqual(d.notes, 'leave at door');
  assert.strictEqual(d.statusHistory.length, 2);
  assert.strictEqual(d.pharmacy.nameEn, 'Pharmacy One');
  assert.strictEqual(d.items[0].savingsUsd, 2.4);
  assert.strictEqual(d.items[0].lineTotal, 960);
  assert.strictEqual(d.hasReturn, true);
});

// --- reviews ---------------------------------------------------------------

test('pharmacy received-reviews response keeps all fields', async () => {
  const result = await reviewService.listReviewsForPharmacy(ids.pharmacy);
  const { reviews, averageRating } = reviewViewModel.toReviewsResponse(result);
  assert.strictEqual(averageRating, 4);
  assert.strictEqual(reviews.length, 1);
  const r = reviews[0];
  assert.strictEqual(r.orderNumber, 5001);
  assert.strictEqual(r.warehouseNameEn, 'Warehouse One');
  assert.strictEqual(r.rating, 4);
  assert.strictEqual(r.comment, 'ok');
  assert.strictEqual(r.reviewerName, 'مستودع', 'resolveReviewerName uses warehouse.nameAr');
});

test('warehouse received-reviews response keeps all fields', async () => {
  const { rows, averageRating } = await warehouseReviewService.listPaginatedReviewsForWarehouse(
    ids.warehouse, { limit: 10 }
  );
  const { reviews } = warehouseReviewViewModel.toWarehouseReviewsResponse({ reviews: rows, averageRating });
  assert.strictEqual(reviews.length, 1);
  const r = reviews[0];
  assert.strictEqual(r.orderNumber, 5001);
  assert.strictEqual(r.pharmacyNameEn, 'Pharmacy One');
  assert.strictEqual(r.rating, 5);
  assert.strictEqual(r.reviewerType, 'pharmacy');
  assert.strictEqual(r.reviewerName, 'Pharm Owner', 'resolveReviewerName uses pharmacy.ownerName');
});

// --- warehouse profile ---------------------------------------------------

test('warehouse profile response keeps its full field set', async () => {
  const data = await warehouseService.getWarehouseProfile(ids.warehouse);
  const p = warehouseViewModel.toWarehouseProfileResponse(data);
  assert.deepStrictEqual(
    Object.keys(p).sort(),
    ['id', 'nameAr', 'nameEn', 'address', 'city', 'phone', 'logo', 'deliveryStartTime',
      'deliveryEndTime', 'deliveryType', 'minOrderAmountUsd', 'maxOrderAmountUsd',
      'averageRating', 'reviewsCount', 'recentReviews'].sort()
  );
  assert.strictEqual(p.nameEn, 'Warehouse One');
  assert.strictEqual(p.address, '9 Rd');
  assert.strictEqual(p.deliveryStartTime, '08:00');
  assert.strictEqual(p.minOrderAmountUsd, 10);
  assert.strictEqual(p.maxOrderAmountUsd, 900);
  assert.strictEqual(p.reviewsCount, 1);
  assert.strictEqual(p.averageRating, 5);
  assert.strictEqual(p.recentReviews[0].reviewerName, 'Pharm Owner');
});

test('available-warehouses list response keeps exactly its documented keys', async () => {
  const warehouses = await warehouseService.listAvailableWarehouses();
  const { warehouses: rows } = warehouseViewModel.toWarehouseListResponse(warehouses);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(
    Object.keys(rows[0]).sort(),
    ['city', 'id', 'logo', 'maxOrderAmountUsd', 'minOrderAmountUsd', 'nameAr', 'nameEn', 'phone'].sort()
  );
  assert.strictEqual(rows[0].nameEn, 'Warehouse One');
  assert.strictEqual(rows[0].minOrderAmountUsd, 10);
});

// --- returns -------------------------------------------------------------

test('pharmacy returns list keeps return + item-name fields', async () => {
  const { rows } = await returnServiceModule.listReturnsForPharmacy(ids.pharmacy, {});
  const { returns } = returnViewModel.toReturnListResponse(rows);
  assert.strictEqual(returns.length, 1);
  const r = returns[0];
  assert.strictEqual(r.orderNumber, 5001);
  assert.strictEqual(r.status, 'pending');
  assert.strictEqual(r.notes, 'broken seal');
  assert.deepStrictEqual(r.images, ['https://x/r.jpg']);
  assert.strictEqual(r.items[0].productNameEn, 'Med');
  assert.strictEqual(r.items[0].quantity, 1);
});

test('warehouse returns list + detail keep return + pharmacy + item fields', async () => {
  const rows = await warehouseReturnService.listReturnsForWarehouse(ids.warehouse);
  const { returns } = warehouseReturnViewModel.toWarehouseReturnsResponse(rows);
  assert.strictEqual(returns.length, 1);
  assert.strictEqual(returns[0].orderNumber, 5001);
  assert.strictEqual(returns[0].pharmacyNameEn, 'Pharmacy One');
  assert.strictEqual(returns[0].pharmacyPhone, '0930000001');
  assert.strictEqual(returns[0].items[0].productNameEn, 'Med');

  const returnId = String(rows[0].returnRequest._id);
  const detail = await warehouseReturnService.getReturnDetailForWarehouse(returnId, ids.warehouse);
  const payload = warehouseReturnViewModel.toWarehouseReturnDetailResponse(detail);
  assert.strictEqual(payload.return.orderNumber, 5001);
  assert.strictEqual(payload.return.pharmacyNameEn, 'Pharmacy One');
  assert.strictEqual(payload.return.notes, 'broken seal');
  assert.strictEqual(payload.return.items[0].productNameAr, 'دواء');
});

// --- offers -------------------------------------------------------------

test('warehouse offers list keeps offer + product-name fields', async () => {
  const rows = await warehouseOfferService.listOffersForWarehouse(ids.warehouse);
  const { offers } = warehouseOfferViewModel.toOfferListResponse(rows);
  assert.strictEqual(offers.length, 1);
  const o = offers[0];
  assert.deepStrictEqual(
    Object.keys(o).sort(),
    ['id', 'productId', 'productNameAr', 'productNameEn', 'titleAr', 'titleEn',
      'discountPercentage', 'startDate', 'endDate', 'isPermanent', 'status', 'pendingUpdate',
      'createdAt'].sort()
  );
  assert.strictEqual(o.titleEn, 'Sale');
  assert.strictEqual(o.discountPercentage, 10);
  assert.strictEqual(o.productNameEn, 'Med', 'resolved from the linked catalog entry');
  assert.strictEqual(o.status, 'approved');
  assert.strictEqual(o.isPermanent, false);
  assert.strictEqual(o.pendingUpdate, null);
});

test('admin pending-offers list keeps offer + product + warehouse fields', async () => {
  await Offer.create({
    warehouseId: ids.warehouse, productId: ids.product, titleAr: 'ب', titleEn: 'Pending Sale',
    discountPercentage: 15, startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'),
    status: 'pending',
  });
  const rows = await adminOfferService.listPendingOffers();
  const { offers } = adminOfferViewModel.toPendingOffersResponse(rows);
  assert.strictEqual(offers.length, 1);
  const o = offers[0];
  assert.strictEqual(o.titleEn, 'Pending Sale');
  assert.strictEqual(o.discountPercentage, 15);
  assert.strictEqual(o.productNameEn, 'Med');
  assert.strictEqual(o.productPriceUsd, 12);
  assert.strictEqual(o.warehouseNameEn, 'Warehouse One');
});

// --- discounts --------------------------------------------------------

test('manufacturer-discounts list keeps its fields', async () => {
  const discounts = await discountService.listDiscountsForWarehouse(ids.warehouse);
  const { discounts: rows } = discountViewModel.toDiscountListResponse(discounts);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(
    Object.keys(rows[0]).sort(),
    ['id', 'manufacturerAr', 'discountPercentage', 'createdAt'].sort()
  );
  assert.strictEqual(rows[0].manufacturerAr, 'شركة');
  assert.strictEqual(rows[0].discountPercentage, 5);
});

// --- banners ---------------------------------------------------------

test('active banners list keeps exactly its five slide fields', async () => {
  const banners = await bannerService.listActiveBanners();
  const { banners: rows } = bannerViewModel.toActiveBannersResponse(banners);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(
    Object.keys(rows[0]).sort(),
    ['id', 'imageUrl', 'productId', 'manufacturerAr', 'warehouseId'].sort()
  );
  assert.strictEqual(rows[0].imageUrl, 'https://x/b.jpg');
  assert.strictEqual(String(rows[0].warehouseId), String(ids.warehouse));
});

test('admin banners list keeps banner + warehouse + product fields', async () => {
  const rows = await adminBannerService.listBanners('all');
  const { banners } = adminBannerViewModel.toAdminBannersResponse(rows);
  assert.strictEqual(banners.length, 1);
  const b = banners[0];
  assert.strictEqual(b.bannerNumber, 700);
  assert.strictEqual(b.title, 'Promo');
  assert.strictEqual(b.status, 'approved');
  assert.strictEqual(b.warehouseNameEn, 'Warehouse One');
  assert.strictEqual(b.productNameEn, 'Med');
  assert.strictEqual(b.manufacturerAr, 'شركة');
});

test('warehouse banners list keeps its fields', async () => {
  const { rows } = await warehouseBannerService.listPaginatedBannersForWarehouse(ids.warehouse, { limit: 10 });
  const { banners } = warehouseBannerViewModel.toWarehouseBannersResponse(rows);
  assert.strictEqual(banners.length, 1);
  assert.deepStrictEqual(
    Object.keys(banners[0]).sort(),
    ['id', 'bannerNumber', 'imageUrl', 'productId', 'manufacturerAr', 'title', 'status',
      'rejectionNote', 'startDate', 'endDate', 'createdAt'].sort()
  );
  assert.strictEqual(banners[0].title, 'Promo');
});

// --- balances --------------------------------------------------------

test('debtor / debt lists keep the counterparty name + totals', async () => {
  const debtorRows = await balanceService.listPaginatedDebtorsForWarehouse(ids.warehouse, { limit: 10 });
  const { pharmacies } = balanceViewModel.toDebtorListResponse(debtorRows.rows);
  assert.strictEqual(pharmacies.length, 1);
  assert.strictEqual(pharmacies[0].nameEn, 'Pharmacy One');
  assert.strictEqual(pharmacies[0].phone, '0930000001');
  assert.strictEqual(pharmacies[0].balanceUsd, 200);

  const debtRows = await balanceService.listDebtsForPharmacy(ids.pharmacy);
  const { warehouses } = balanceViewModel.toDebtListResponse(debtRows);
  assert.strictEqual(warehouses[0].nameEn, 'Warehouse One');
  assert.strictEqual(warehouses[0].phone, '0930000002');
  assert.strictEqual(warehouses[0].totalOrdersUsd, 300);
});

test('balance detail keeps the "other party" name + phone for each viewer role', async () => {
  const detail = await balanceService.getBalanceDetail(ids.pharmacy, ids.warehouse);

  const asPharmacy = balanceViewModel.toBalanceDetailResponse(detail, 'pharmacy');
  assert.strictEqual(asPharmacy.warehouse.nameEn, 'Warehouse One');
  assert.strictEqual(asPharmacy.warehouse.phone, '0930000002');
  assert.strictEqual(asPharmacy.pharmacy, undefined);

  const asWarehouse = balanceViewModel.toBalanceDetailResponse(detail, 'warehouse');
  assert.strictEqual(asWarehouse.pharmacy.nameEn, 'Pharmacy One');
  assert.strictEqual(asWarehouse.pharmacy.phone, '0930000001');
  assert.strictEqual(asWarehouse.balanceUsd, 200);
});
