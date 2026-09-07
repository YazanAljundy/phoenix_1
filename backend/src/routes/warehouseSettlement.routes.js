const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/warehouseSettlement.controller');

const router = Router();

router.use(authenticate, authorize('warehouse'), requireActiveStatus);

// Money-Flow V2: commission owed to the platform for a period, and what the
// warehouse nets after it. Read-only - posts nothing.
router.get('/', controller.get);

module.exports = router;
