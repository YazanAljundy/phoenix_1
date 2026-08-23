const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const controller = require('../controllers/banner.controller');

const router = Router();

// No role/status restriction - any authenticated user (pharmacy, warehouse,
// or admin) can see active banners, not just pharmacists.
router.get('/active', authenticate, controller.listActive);

module.exports = router;
