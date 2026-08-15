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

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/offers', adminOfferRoutes);
router.use('/admin/products', adminProductRoutes);
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

// Feature routes are mounted here as each day's work adds them:
// ...

module.exports = router;
