const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/adminOffer.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', controller.listPending);
router.get('/all', controller.listAll);
router.post('/:id/approve', controller.approve);
router.post('/:id/reject', controller.reject);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
