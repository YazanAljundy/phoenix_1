const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/product.controller');

// mergeParams: true - this router is mounted at /warehouses/:warehouseId/products
// (see warehouse.routes.js) and needs access to the parent's :warehouseId.
const router = Router({ mergeParams: true });

router.get('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.list);

module.exports = router;
