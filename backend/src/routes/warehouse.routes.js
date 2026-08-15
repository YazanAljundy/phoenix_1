const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/warehouse.controller');
const productRoutes = require('./product.routes');

const router = Router();

router.get('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.list);
router.use('/:warehouseId/products', productRoutes);

module.exports = router;
