const { Router } = require('express');
const { authenticate, authorize, requireActiveStatus } = require('../middlewares/auth.middleware');
const controller = require('../controllers/review.controller');

const router = Router();

router.get('/', authenticate, authorize('pharmacy'), requireActiveStatus, controller.list);

module.exports = router;
