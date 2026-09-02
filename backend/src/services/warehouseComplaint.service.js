const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Complaint = require('../models/complaint.model');
const { attachComplaintContext, paginateComplaints, loadResponder } = require('./complaint.service');

// Section 3/6: the warehouse sees ONLY the complaints filed against its own
// warehouse. The filter is the warehouse resolved from the authenticated
// user's profile (warehouseComplaint.controller.js), never a client id, so a
// warehouse can never page into another warehouse's complaints.
async function listComplaintsForWarehouse(warehouseId, opts = {}) {
  return paginateComplaints({ warehouseId }, opts, { withPharmacy: true });
}

// IDOR guard: scoped to warehouseId. A complaint against a different warehouse
// is a 404 here, exactly like warehouseReturn.service.js's findOwnReturnOrThrow.
async function getComplaintForWarehouse(complaintId, warehouseId) {
  if (!mongoose.Types.ObjectId.isValid(complaintId)) {
    throw ApiError.notFound('Complaint not found.', 'COMPLAINT_NOT_FOUND');
  }
  const complaint = await Complaint.findOne({ _id: complaintId, warehouseId }).lean();
  if (!complaint) {
    throw ApiError.notFound('Complaint not found.', 'COMPLAINT_NOT_FOUND');
  }
  const [row] = await attachComplaintContext([complaint], { withPharmacy: true });
  const responder = await loadResponder(complaint);
  return { ...row, responder };
}

module.exports = { listComplaintsForWarehouse, getComplaintForWarehouse };
