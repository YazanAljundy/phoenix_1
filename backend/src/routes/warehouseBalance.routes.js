const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/warehouseBalance.controller');

const router = Router();

router.use(authenticate, authorize('warehouse'), requireActiveStatus);

// Money-Flow V2: the per-pharmacy detail is a chronological account statement
// over the ledger. The path is unchanged so the panel's existing route
// resolves; the payload is the statement plus the payment rows.
router.get('/', controller.list);
router.get('/:pharmacyId', controller.getOne);

module.exports = router;
