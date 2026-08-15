const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const { returnPhotosUpload } = require('../middlewares/upload.middleware');
const controller = require('../controllers/return.controller');

const router = Router();

router.use(authenticate, authorize('pharmacy'), requireActiveStatus);

router.post('/', returnPhotosUpload, controller.create);
router.get('/', controller.list);
router.put('/:id', returnPhotosUpload, controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
