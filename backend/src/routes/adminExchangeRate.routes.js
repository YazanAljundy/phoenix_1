const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/adminExchangeRate.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', controller.getRate);
// Money-Flow V2: the append-only trail of every rate the singleton has held.
router.get('/history', controller.listHistory);
router.patch('/', controller.setManualRate);
router.patch('/reset', controller.resetToApi);

module.exports = router;
