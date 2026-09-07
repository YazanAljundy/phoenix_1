const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/adminLedger.controller');

const router = Router();

// Admin-only throughout. Manual adjustments move a balance without a business
// event behind them, so they are kept with the platform rather than handed to
// warehouses - see ledgerAdjustment.service.js.
router.use(authenticate, authorize('admin'));

router.post('/adjustments', controller.createAdjustment);
router.post('/adjustments/:entryId/reverse', controller.reverseAdjustment);
router.post('/accounts/:accountId/rebuild-balance', controller.rebuildBalance);
router.get('/accounts/:pharmacyId/:warehouseId/statement', controller.statement);

module.exports = router;
