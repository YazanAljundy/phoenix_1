const { Router } = require('express');
const { authLimiter, phoneAuthLimiter } = require('../middlewares/rateLimiter');
const { authenticate } = require('../middlewares/auth.middleware');
const controller = require('../controllers/auth.controller');

const router = Router();

// Two limiters on the credential endpoints, not one (Audit H-2):
//   authLimiter      - 20 / 15min / ADDRESS, unchanged. Bounds one noisy source.
//   phoneAuthLimiter - 10 failures / hour / PHONE NUMBER. Bounds what any
//                      number of addresses can do to one account.
// Neither replaces the other; see the comments in rateLimiter.js.
const credentialLimiters = [authLimiter, phoneAuthLimiter];

router.post('/otp/send', authLimiter, controller.sendOtp);
router.post('/register', ...credentialLimiters, controller.register);
router.post('/login', authLimiter, controller.login);
router.post('/login-password', ...credentialLimiters, controller.loginWithPassword);

// Password recovery (Audit H-3). These are what make it safe for /auth/register
// to refuse a phone that already has an account (Audit C-1) - before them, a
// forgotten password had no recovery path at all and re-registering WAS the
// recovery path.
//
// Both are phone-keyed as well as address-keyed: /forgot-password is an SMS
// send (costly, and abusable as an SMS bomb against one number) and
// /reset-password is a guess at a 6-digit code. The per-code attempt ceiling in
// otp.service.js is the primary guard on the latter; this is the outer one.
router.post('/forgot-password', ...credentialLimiters, controller.forgotPassword);
router.post('/reset-password', ...credentialLimiters, controller.resetPassword);

router.get('/me', authenticate, controller.me);
router.post('/device-token', authenticate, controller.registerDeviceToken);

// Authenticated account management. Both re-check the current password inside
// the service: holding a valid token is not sufficient authority to change a
// credential or destroy the account.
router.post('/change-password', authenticate, controller.changePassword);
router.delete('/account', authenticate, controller.deleteAccount);

module.exports = router;
