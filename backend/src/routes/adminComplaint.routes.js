const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/adminComplaint.controller');

const router = Router();

// Section 6: admin-only. Same router-level authorize('admin') guard as the
// other admin route groups (adminOffer.routes.js etc.).
router.use(authenticate, authorize('admin'));

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/:id/respond', controller.respond);
router.patch('/:id/status', controller.updateStatus);

module.exports = router;
