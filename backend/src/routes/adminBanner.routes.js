const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { adminBannerMediaUpload } = require('../middlewares/upload.middleware');
const controller = require('../controllers/adminBanner.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', controller.list);
router.post('/', adminBannerMediaUpload, controller.create);
router.patch('/:id/approve', controller.approve);
router.patch('/:id/reject', controller.reject);
router.patch('/:id', adminBannerMediaUpload, controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
