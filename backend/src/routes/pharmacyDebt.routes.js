const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/pharmacyDebt.controller');

const router = Router();

router.use(authenticate, authorize('pharmacy'), requireActiveStatus);

// Money-Flow V2: the per-warehouse detail is now a chronological account
// statement over the ledger, not two disconnected lists with separately
// computed totals. `/:warehouseId` is kept as the statement's path so the
// existing client route shape still resolves.
router.get('/', controller.list);
router.get('/:warehouseId', controller.statement);

module.exports = router;
