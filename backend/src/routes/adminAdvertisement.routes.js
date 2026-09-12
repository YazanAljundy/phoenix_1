const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
// Shared with Banner - same memory-storage, magic-byte-checked, 5MB single
// 'image' upload, not a new mechanism just for advertisements.
const { bannerImageUpload } = require('../middlewares/upload.middleware');
const controller = require('../controllers/adminAdvertisement.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', controller.listPending);
router.get('/all', controller.listAll);
router.post('/:id/approve', controller.approve);
router.post('/:id/reject', controller.reject);
router.patch('/:id/availability', controller.updateAvailability);
router.patch('/:id', bannerImageUpload, controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
