const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/adminProduct.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', controller.list);
router.get('/warehouses', controller.listWarehouses);
router.patch('/:id', controller.update);
router.delete('/:id', controller.deactivate);

module.exports = router;
