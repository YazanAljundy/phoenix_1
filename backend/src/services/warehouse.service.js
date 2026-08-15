const mongoose = require('mongoose');
const User = require('../models/user.model');
const Warehouse = require('../models/warehouse.model');

// Section 7: a warehouse only appears to pharmacists once its user has been
// admin-approved (users.status = 'active'), and warehouses.isActive lets an
// already-approved warehouse be temporarily paused without losing approval.
async function listAvailableWarehouses() {
  const activeWarehouseUsers = await User.find({ role: 'warehouse', status: 'active' }).select('_id');
  const userIds = activeWarehouseUsers.map((u) => u._id);

  return Warehouse.find({ userId: { $in: userIds }, isActive: true }).sort({ nameEn: 1 });
}

// Same availability rule as above, for a single warehouse - used by the
// products endpoint so a paused/unapproved warehouse's catalog can't be
// reached just by knowing its id (Section 15b, IDOR prevention).
async function isWarehouseAvailable(warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
    return false;
  }
  const warehouse = await Warehouse.findOne({ _id: warehouseId, isActive: true });
  if (!warehouse) {
    return false;
  }
  const user = await User.findOne({ _id: warehouse.userId, role: 'warehouse', status: 'active' });
  return Boolean(user);
}

module.exports = { listAvailableWarehouses, isWarehouseAvailable };
