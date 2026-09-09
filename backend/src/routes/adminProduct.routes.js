const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/adminProduct.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', controller.list);
// Both registered before '/:id'-shaped routes would matter - they're static
// siblings here, kept adjacent since they're the two non-list reads.
router.get('/count', controller.count);
router.get('/warehouses', controller.listWarehouses);
router.patch('/:id', controller.update);
router.delete('/:id', controller.deactivate);

module.exports = router;
