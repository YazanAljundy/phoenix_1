const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/adminExchangeRate.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', controller.getRate);
router.patch('/', controller.setManualRate);
router.patch('/reset', controller.resetToApi);

module.exports = router;
