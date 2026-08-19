const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/pharmacyDebt.controller');

const router = Router();

router.use(authenticate, authorize('pharmacy'), requireActiveStatus);

router.get('/', controller.list);
router.get('/:warehouseId', controller.getOne);

module.exports = router;
