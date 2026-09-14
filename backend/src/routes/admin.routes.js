const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/admin.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/pending-accounts', controller.listPendingAccounts);
// The Accounts management page - both roles, every status, filters + search.
router.get('/accounts', controller.listAccounts);
router.post('/accounts/:userId/approve', controller.approveAccount);
router.post('/accounts/:userId/reject', controller.rejectAccount);
// Admin-only administrative actions (router-level authorize('admin') above).
router.post('/accounts/:userId/block', controller.blockAccount);
router.post('/accounts/:userId/unblock', controller.unblockAccount);
// Emergency password recovery, admin-only by the router-level guard above.
// This sets another user's credential, so it must never become reachable by any
// other role - and it reaches pharmacies and warehouses only, never another
// admin (admin.service.js explains why).
router.post('/accounts/:userId/reset-password', controller.resetAccountPassword);
// Admin-only by the router-level authorize('admin') above - this mints a
// warehouse login, so it must never be reachable by any other role.
router.post('/warehouses', controller.createWarehouse);
router.post('/notifications', controller.broadcastNotification);

module.exports = router;
