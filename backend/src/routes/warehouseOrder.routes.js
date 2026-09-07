const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/warehouseOrder.controller');
const balanceController = require('../controllers/warehouseBalance.controller');

const router = Router();

router.use(authenticate, authorize('warehouse'), requireActiveStatus);

router.get('/', controller.list);
// Money-Flow V2: the immutable invoice, with the commission and net figures
// the pharmacy's copy omits.
router.get('/:orderId/invoice', balanceController.invoice);
router.get('/:id', controller.getDetail);
router.post('/:id/advance-status', controller.advance);
router.patch('/:id/items', controller.updateItems);
// Per-order proof-of-delivery toggle - just this one flag on the order.
router.patch('/:id/delivery-seal', controller.setDeliverySealRequirement);

module.exports = router;
