const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/warehouse.controller');
const productController = require('../controllers/product.controller');
const productRoutes = require('./product.routes');

const router = Router();

router.get('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.list);
// Section 17: the pharmacist's read-only "about this warehouse" screen -
// reached from a separate affordance on the warehouse card, not the
// "select" button (that one still goes straight to /manufacturers).
router.get(
  '/:warehouseId/profile',
  authenticate,
  authorize('pharmacy'),
  requireActiveStatus,
  controller.profile
);
// Sibling of /:warehouseId/products (not nested under it) - the pharmacist's
// new warehouse -> manufacturers -> medicines flow reads this before the
// products list, see product.service.js's listDistinctManufacturersForWarehouse.
router.get(
  '/:warehouseId/manufacturers',
  authenticate,
  authorize('pharmacy'),
  requireActiveStatus,
  productController.manufacturers
);
router.use('/:warehouseId/products', productRoutes);

module.exports = router;
