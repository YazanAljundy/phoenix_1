const { Router } = require('express');
const { authLimiter } = require('../middlewares/rateLimiter');
const { authenticate } = require('../middlewares/auth.middleware');
const { verificationPhotoUpload } = require('../middlewares/upload.middleware');
const controller = require('../controllers/auth.controller');

const router = Router();

router.post('/otp/send', authLimiter, controller.sendOtp);
router.post('/register', authLimiter, verificationPhotoUpload, controller.register);
router.post('/login', authLimiter, controller.login);
router.post('/login-password', authLimiter, controller.loginWithPassword);
router.get('/me', authenticate, controller.me);
router.post('/device-token', authenticate, controller.registerDeviceToken);

module.exports = router;
