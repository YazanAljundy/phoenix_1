const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/category.controller');

const router = Router();

// Categories are shared reference data (no warehouseId) - pharmacists
// browsing a catalog, warehouses managing their own products, and admins
// managing products across every warehouse (Section 13c) all need to read
// this list.
router.get('/', authenticate, authorize('pharmacy', 'warehouse', 'admin'), requireActiveStatus, controller.list);

module.exports = router;
