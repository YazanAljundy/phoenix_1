const { Router } = require('express');
const { authLimiter, refreshLimiter } = require('../middlewares/rateLimiter');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/auth.controller');

const router = Router();

router.post('/otp/send', authLimiter, controller.sendOtp);
router.post('/register', authLimiter, controller.register);
router.post('/login', authLimiter, controller.login);
router.post('/login-password', authLimiter, controller.loginWithPassword);
router.post('/refresh', refreshLimiter, controller.refresh);
router.get('/me', authenticate, controller.me);
router.post('/change-password', authenticate, controller.changePassword);
// Admin-only password reset for another account (audit F-06). Kept on the
// /auth router rather than /admin because it is password machinery, and it
// shares changePassword's hashing and session-revocation path.
router.post('/admin/reset-password/:userId', authenticate, authorize('admin'), controller.adminResetPassword);
router.post('/device-token', authenticate, controller.registerDeviceToken);

module.exports = router;
