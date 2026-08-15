const { asyncHandler } = require('../utils/asyncHandler');
const adminService = require('../services/admin.service');
const adminViewModel = require('../viewmodels/admin.viewmodel');

const listPendingAccounts = asyncHandler(async (req, res) => {
  const items = await adminService.listPendingAccounts();
  res.json({ success: true, ...adminViewModel.toPendingAccountsResponse(items) });
});

const approveAccount = asyncHandler(async (req, res) => {
  await adminService.approveAccount(req.params.userId);
  res.json({ success: true, message: 'Account approved.' });
});

const rejectAccount = asyncHandler(async (req, res) => {
  await adminService.rejectAccount(req.params.userId);
  res.json({ success: true, message: 'Account rejected.' });
});

module.exports = { listPendingAccounts, approveAccount, rejectAccount };
