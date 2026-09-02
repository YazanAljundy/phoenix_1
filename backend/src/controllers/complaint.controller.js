const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Pharmacy = require('../models/pharmacy.model');
const complaintService = require('../services/complaint.service');
const complaintViewModel = require('../viewmodels/complaint.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

const COMPLAINTS_DEFAULT_LIMIT = 15;

// Same pattern as order/return controllers: the pharmacy is always resolved
// from the JWT, never from the request body.
async function loadPharmacyOrThrow(userId) {
  const pharmacy = await Pharmacy.findOne({ userId }).select('_id').lean();
  if (!pharmacy) {
    throw ApiError.notFound('Pharmacy profile not found.', 'PHARMACY_NOT_FOUND');
  }
  return pharmacy;
}

const create = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  // The client sends CONTEXT only - `warehouseId` for a warehouse complaint,
  // `relatedOrderId` for an order complaint, neither for a general one. There
  // is no "type" field. The service decides everything from these, and never
  // trusts warehouse/order details beyond the id it re-resolves.
  const { warehouseId, relatedOrderId, subject, description, extraDetails } = req.body;

  const complaint = await complaintService.createComplaint({
    pharmacyId: pharmacy._id,
    pharmacyUserId: req.user._id,
    warehouseId,
    relatedOrderId,
    subject,
    description,
    extraDetails,
  });

  const [row] = await complaintService.attachComplaintContext([complaint.toObject()]);
  res.status(201).json({
    success: true,
    message: 'Complaint submitted.',
    ...complaintViewModel.toPharmacyComplaintResponse(row),
  });
});

const list = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const { limit, after } = parseCursorQuery(req.query, COMPLAINTS_DEFAULT_LIMIT);
  const cursor = parseObjectIdCursor(after);

  const { rows, hasMore, nextCursor } = await complaintService.listComplaintsForPharmacy(pharmacy._id, {
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...complaintViewModel.toPharmacyComplaintListResponse(rows),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const getOne = asyncHandler(async (req, res) => {
  const pharmacy = await loadPharmacyOrThrow(req.user._id);
  const row = await complaintService.getComplaintForPharmacy(req.params.id, pharmacy._id);
  res.json({
    success: true,
    ...complaintViewModel.toPharmacyComplaintResponse(row),
  });
});

module.exports = { create, list, getOne };
