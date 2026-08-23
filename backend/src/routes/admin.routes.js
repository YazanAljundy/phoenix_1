const { Router } = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const controller = require('../controllers/admin.controller');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/pending-accounts', controller.listPendingAccounts);
router.post('/accounts/:userId/approve', controller.approveAccount);
router.post('/accounts/:userId/reject', controller.rejectAccount);
// Admin-only by the router-level authorize('admin') above - this mints a
// warehouse login, so it must never be reachable by any other role.
router.post('/warehouses', controller.createWarehouse);
router.post('/notifications', controller.broadcastNotification);

module.exports = router;
