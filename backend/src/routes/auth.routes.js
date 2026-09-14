const { Router } = require('express');
const { authLimiter, refreshLimiter, phoneAuthLimiter } = require('../middlewares/rateLimiter');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
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

// Refresh keeps its own far more generous per-IP bucket (audit F-03): access
// tokens live 24h, so a CGNAT'd morning of pharmacies all refreshing inside one
// quarter-hour must not trip authLimiter's 20 and log them out. Not phone-keyed
// - a refresh carries no phone, only the refresh token itself.
router.post('/refresh', refreshLimiter, controller.refresh);

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

// Authenticated account management. Both re-check the current password inside
// the service: holding a valid token is not sufficient authority to change a
// credential or destroy the account.
router.post('/change-password', authenticate, controller.changePassword);
router.delete('/account', authenticate, controller.deleteAccount);

// Admin-only password reset for another account (audit F-06). Kept on the
// /auth router rather than /admin because it is password machinery, and it
// shares changePassword's hashing and session-revocation path. This is the
// single admin reset path: the parallel POST /admin/accounts/:userId/
// reset-password from the audit branch was folded into it during the merge,
// with its extra guards carried over (see adminResetPassword in
// auth.service.js).
router.post('/admin/reset-password/:userId', authenticate, authorize('admin'), controller.adminResetPassword);

router.post('/device-token', authenticate, controller.registerDeviceToken);
router.delete('/device-token', authenticate, controller.deleteDeviceToken);

module.exports = router;
