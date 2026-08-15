const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/order.controller');

const router = Router();

router.post('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.create);
router.get('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.list);
router.get('/:id', authenticate, authorize('pharmacy'), requireActiveStatus, controller.getOne);
router.post('/:id/cancel', authenticate, authorize('pharmacy'), requireActiveStatus, controller.cancel);

module.exports = router;
