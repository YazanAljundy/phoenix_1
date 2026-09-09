const { Router } = require('express');
const { authLimiter, refreshLimiter } = require('../middlewares/rateLimiter');
const { authenticate } = require('../middlewares/auth.middleware');
const controller = require('../controllers/auth.controller');

const router = Router();

router.post('/otp/send', authLimiter, controller.sendOtp);
router.post('/register', authLimiter, controller.register);
router.post('/login', authLimiter, controller.login);
router.post('/login-password', authLimiter, controller.loginWithPassword);
router.post('/refresh', refreshLimiter, controller.refresh);
router.get('/me', authenticate, controller.me);
router.post('/device-token', authenticate, controller.registerDeviceToken);

module.exports = router;
