const { Router } = require('express');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin.routes');
const warehouseRoutes = require('./warehouse.routes');
const categoryRoutes = require('./category.routes');
const orderRoutes = require('./order.routes');
const returnRoutes = require('./return.routes');
const warehouseOrderRoutes = require('./warehouseOrder.routes');
const warehouseProductRoutes = require('./warehouseProduct.routes');
const warehouseOfferRoutes = require('./warehouseOffer.routes');
const adminOfferRoutes = require('./adminOffer.routes');
const warehouseReturnRoutes = require('./warehouseReturn.routes');
const warehouseReviewRoutes = require('./warehouseReview.routes');
const reviewRoutes = require('./review.routes');
const adminProductRoutes = require('./adminProduct.routes');
const exchangeRateRoutes = require('./exchangeRate.routes');
const adminExchangeRateRoutes = require('./adminExchangeRate.routes');
const adminCatalogRoutes = require('./adminCatalog.routes');
const warehouseCatalogRoutes = require('./warehouseCatalog.routes');
const warehouseDiscountRoutes = require('./warehouseDiscount.routes');
const warehouseManufacturerRoutes = require('./warehouseManufacturer.routes');
const warehouseBalanceRoutes = require('./warehouseBalance.routes');
const warehousePaymentRoutes = require('./warehousePayment.routes');
const pharmacyDebtRoutes = require('./pharmacyDebt.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/offers', adminOfferRoutes);
router.use('/admin/products', adminProductRoutes);
router.use('/admin/exchange-rate', adminExchangeRateRoutes);
router.use('/exchange-rate', exchangeRateRoutes);
router.use('/admin/catalog', adminCatalogRoutes);
router.use('/warehouse/catalog', warehouseCatalogRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/categories', categoryRoutes);
router.use('/orders', orderRoutes);
router.use('/returns', returnRoutes);
router.use('/reviews', reviewRoutes);
router.use('/warehouse/orders', warehouseOrderRoutes);
router.use('/warehouse/products', warehouseProductRoutes);
router.use('/warehouse/offers', warehouseOfferRoutes);
router.use('/warehouse/returns', warehouseReturnRoutes);
router.use('/warehouse/reviews', warehouseReviewRoutes);
router.use('/warehouse/discounts', warehouseDiscountRoutes);
router.use('/warehouse/manufacturers', warehouseManufacturerRoutes);
router.use('/warehouse/balances', warehouseBalanceRoutes);
router.use('/warehouse/payments', warehousePaymentRoutes);
router.use('/pharmacy/debts', pharmacyDebtRoutes);

// Feature routes are mounted here as each day's work adds them:
// ...

module.exports = router;
