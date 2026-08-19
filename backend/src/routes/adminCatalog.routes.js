const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { catalogImportUpload } = require('../middlewares/upload.middleware');
const controller = require('../controllers/adminCatalog.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

// Order matters: /template must be registered before /:id-shaped routes in
// spirit, though here it's a sibling static path under the same router, not
// a conflict - kept first for readability (the "how do I add medicines"
// entry point before the CRUD-ish routes).
router.get('/template', controller.downloadTemplate);
router.get('/', controller.list);
router.post('/import', catalogImportUpload, controller.importExcel);
router.patch('/:id', controller.update);
router.delete('/:id', controller.deactivate);

module.exports = router;
