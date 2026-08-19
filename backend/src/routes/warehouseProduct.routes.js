const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const { catalogImportUpload } = require('../middlewares/upload.middleware');
const controller = require('../controllers/warehouseProduct.controller');

const router = Router();

router.use(authenticate, authorize('warehouse'), requireActiveStatus);

router.get('/template', controller.downloadTemplate);
router.get('/', controller.list);
router.post('/', controller.create);
router.post('/import', catalogImportUpload, controller.importExcel);
router.patch('/:id', controller.update);

module.exports = router;
