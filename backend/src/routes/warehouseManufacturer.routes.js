const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/warehouseManufacturer.controller');

const router = Router();

router.get('/', authenticate, authorize('warehouse'), requireActiveStatus, controller.list);

module.exports = router;
