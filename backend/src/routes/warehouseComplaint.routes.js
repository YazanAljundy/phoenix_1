const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/warehouseComplaint.controller');

const router = Router();

// Section 6: warehouse-only, and read-only - a warehouse can view the
// complaints filed against it but the reply path belongs to the admin
// (Section 3). No POST/PATCH routes exist here at all.
router.use(authenticate, authorize('warehouse'), requireActiveStatus);

router.get('/', controller.list);
router.get('/:id', controller.getOne);

module.exports = router;
