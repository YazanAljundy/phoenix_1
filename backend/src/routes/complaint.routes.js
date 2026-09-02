const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/complaint.controller');

const router = Router();

// Section 6: every complaint route is pharmacy-only and requires an approved
// account - enforced here in the backend, not just by hiding buttons.
router.use(authenticate, authorize('pharmacy'), requireActiveStatus);

router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.getOne);

module.exports = router;
