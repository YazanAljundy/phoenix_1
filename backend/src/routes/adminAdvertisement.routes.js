const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/adminAdvertisement.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', controller.listPending);
router.post('/:id/approve', controller.approve);
router.post('/:id/reject', controller.reject);

module.exports = router;
