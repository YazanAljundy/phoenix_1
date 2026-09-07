const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/warehouseReturn.controller');

const router = Router();

router.use(authenticate, authorize('warehouse'), requireActiveStatus);

router.get('/', controller.list);
router.get('/:id', controller.getDetail);
// Read-only preview of what approving would credit - creates nothing.
router.get('/:id/credit-preview', controller.previewCredit);
router.post('/:id/approve', controller.approve);
router.post('/:id/reject', controller.reject);

module.exports = router;
