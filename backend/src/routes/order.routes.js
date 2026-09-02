const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/order.controller');

const router = Router();

router.post('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.create);
router.get('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.list);
// Registered before '/:id' - otherwise Express matches 'returnable' as an
// order id and this route is never reached.
router.get('/returnable', authenticate, authorize('pharmacy'), requireActiveStatus, controller.listReturnable);
router.get('/:id', authenticate, authorize('pharmacy'), requireActiveStatus, controller.getOne);
router.post('/:id/cancel', authenticate, authorize('pharmacy'), requireActiveStatus, controller.cancel);
// Section: reorder - copies a past delivered order into a cart payload.
// Creates no order (that stays POST '/'); the cart submits normally afterwards.
router.post('/:id/reorder', authenticate, authorize('pharmacy'), requireActiveStatus, controller.reorder);

module.exports = router;
