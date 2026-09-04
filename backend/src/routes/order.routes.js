const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const { deliverySealPhotoUpload } = require('../middlewares/upload.middleware');
const controller = require('../controllers/order.controller');

const router = Router();

router.post('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.create);
router.get('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.list);
// Registered before '/:id' - otherwise Express matches 'returnable' /
// 'savings-summary' as an order id and these routes are never reached.
router.get('/returnable', authenticate, authorize('pharmacy'), requireActiveStatus, controller.listReturnable);
router.get(
  '/savings-summary',
  authenticate,
  authorize('pharmacy'),
  requireActiveStatus,
  controller.savingsSummary
);
router.get('/:id', authenticate, authorize('pharmacy'), requireActiveStatus, controller.getOne);
router.post('/:id/cancel', authenticate, authorize('pharmacy'), requireActiveStatus, controller.cancel);
// Section: optional delivery seal photo - multipart, single `image` field.
// Records the photo on the order; never changes the order status.
router.post(
  '/:id/confirm-delivery',
  authenticate,
  authorize('pharmacy'),
  requireActiveStatus,
  deliverySealPhotoUpload,
  controller.confirmDelivery
);
// Section: reorder - copies a past delivered order into a cart payload.
// Creates no order (that stays POST '/'); the cart submits normally afterwards.
router.post('/:id/reorder', authenticate, authorize('pharmacy'), requireActiveStatus, controller.reorder);

module.exports = router;
