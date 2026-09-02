const mongoose = require('mongoose');
const { ApiError } = require('../utils/ApiError');
const Complaint = require('../models/complaint.model');
const { attachComplaintContext, paginateComplaints, loadResponder } = require('./complaint.service');
const notificationService = require('./notification.service');
const { emitToAdmins, emitToWarehouse, EVENTS } = require('../realtime');

const ADMIN_COMPLAINTS_DEFAULT_LIMIT = 20;
const RESPONSE_MAX = 5000;

function complaintStatuses() {
  return Complaint.schema.path('status').enumValues;
}

function assertValidStatus(status) {
  if (!complaintStatuses().includes(status)) {
    throw ApiError.badRequest('Invalid complaint status.', undefined, 'COMPLAINT_INVALID_STATUS');
  }
}

// Per-status totals for the filter pills - independent of whichever page is
// loaded, same reasoning as adminOffer.service.js's `totalCount`. One grouped
// aggregate instead of four countDocuments round-trips.
async function getStatusCounts() {
  const grouped = await Complaint.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const counts = { all: 0 };
  for (const status of complaintStatuses()) counts[status] = 0;
  for (const { _id: status, count } of grouped) {
    counts[status] = count;
    counts.all += count;
  }
  return counts;
}

// Section 8: the admin's complaint list - every complaint, newest first,
// optionally filtered to one status. Returns the per-status counts alongside
// the page so the filter pills stay accurate regardless of pagination.
async function listComplaints({ status, limit = ADMIN_COMPLAINTS_DEFAULT_LIMIT, after = null } = {}) {
  const filter = {};
  if (status) {
    assertValidStatus(status);
    filter.status = status;
  }
  const [{ rows, hasMore, nextCursor }, counts] = await Promise.all([
    paginateComplaints(filter, { limit, after }, { withPharmacy: true }),
    getStatusCounts(),
  ]);
  return { rows, hasMore, nextCursor, counts };
}

// Admin sees every complaint - no ownership filter, just an existence check.
async function loadComplaintOrThrow(complaintId) {
  if (!mongoose.Types.ObjectId.isValid(complaintId)) {
    throw ApiError.notFound('Complaint not found.', 'COMPLAINT_NOT_FOUND');
  }
  const complaint = await Complaint.findById(complaintId);
  if (!complaint) {
    throw ApiError.notFound('Complaint not found.', 'COMPLAINT_NOT_FOUND');
  }
  return complaint;
}

async function getComplaint(complaintId) {
  const complaint = await loadComplaintOrThrow(complaintId);
  const plain = complaint.toObject();
  const [row] = await attachComplaintContext([plain], { withPharmacy: true });
  const responder = await loadResponder(plain);
  return { ...row, responder };
}

function emitUpdated(complaint) {
  const payload = {
    complaintId: complaint._id.toString(),
    complaintNumber: complaint.complaintNumber,
    warehouseId: complaint.warehouseId.toString(),
    status: complaint.status,
  };
  emitToAdmins(EVENTS.COMPLAINT_UPDATED, payload);
  emitToWarehouse(complaint.warehouseId, EVENTS.COMPLAINT_UPDATED, payload);
}

// Section 10: the admin writes a reply and (optionally) sets a new status in
// the same action. An empty reply is refused.
//
// Concurrency: a complaint's first response is applied with ONE atomic
// findOneAndUpdate whose filter includes `respondedAt: null`. `respondedAt` is
// the schema's real "not yet responded" marker - a Date set exactly once, here,
// and never touched by updateComplaintStatus below. MongoDB evaluates that
// filter in the same operation as the write, so of two requests racing on the
// same complaint exactly one matches an unanswered document and applies its
// `$set`; the other matches nothing, gets `null` back, and is turned into a
// 409 (COMPLAINT_ALREADY_RESPONDED). There is no read-modify-write window for a
// second write - or a second notification - to slip into.
async function respondToComplaint(complaintId, adminUserId, { response, status } = {}) {
  if (!mongoose.Types.ObjectId.isValid(complaintId)) {
    throw ApiError.notFound('Complaint not found.', 'COMPLAINT_NOT_FOUND');
  }

  const trimmed = typeof response === 'string' ? response.trim() : '';
  if (!trimmed) {
    throw ApiError.badRequest(
      'Please write a response before sending.',
      undefined,
      'COMPLAINT_RESPONSE_REQUIRED'
    );
  }
  if (trimmed.length > RESPONSE_MAX) {
    throw ApiError.badRequest(
      `The response must be at most ${RESPONSE_MAX} characters.`,
      { max: RESPONSE_MAX },
      'COMPLAINT_RESPONSE_TOO_LONG'
    );
  }

  const set = {
    adminResponse: trimmed,
    respondedByAdminId: adminUserId,
    respondedAt: new Date(),
  };
  if (status) {
    assertValidStatus(status);
    set.status = status;
  }

  const complaint = await Complaint.findOneAndUpdate(
    { _id: complaintId, respondedAt: null },
    { $set: set },
    { new: true, runValidators: true }
  );

  if (!complaint) {
    // `null` means either the complaint does not exist, or it was already
    // answered (its respondedAt is no longer null). A follow-up existence
    // check tells the two apart so the caller gets the right error.
    const stillExists = await Complaint.exists({ _id: complaintId });
    if (!stillExists) {
      throw ApiError.notFound('Complaint not found.', 'COMPLAINT_NOT_FOUND');
    }
    throw ApiError.conflict(
      'This complaint has already been answered.',
      'COMPLAINT_ALREADY_RESPONDED'
    );
  }

  // Default-resolve when the caller did not pick a target status and the
  // complaint is still open. Safe as a follow-up write: this request has
  // already won the atomic response above, so nothing else is competing for
  // this complaint's response.
  if (!status && (complaint.status === 'pending' || complaint.status === 'in_review')) {
    complaint.status = 'resolved';
    await complaint.save();
  }

  emitUpdated(complaint);

  // Section 11: the notification is sent ONLY after the atomic update above
  // succeeded - a losing concurrent request has already thrown
  // COMPLAINT_ALREADY_RESPONDED and never reaches here, so exactly one
  // notification is generated for a complaint's first response. Still a single
  // sendToUser to the filing pharmacy's stored user id, never a fan-out. The
  // payload carries relatedComplaintId so the app can deep-link straight to
  // the complaint (Section 12). Best-effort: a notification failure never
  // undoes the response, which already persisted above.
  try {
    await notificationService.sendToUser(complaint.pharmacyUserId, {
      titleAr: 'تم الرد على شكواك',
      titleEn: 'Your complaint has received a response',
      bodyAr: `تم الرد على شكواك رقم ${complaint.complaintNumber}`,
      bodyEn: `Your complaint #${complaint.complaintNumber} has received a response`,
      type: 'complaint',
      relatedComplaintId: complaint._id,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to send complaint response notification.', err.message);
  }

  return complaint;
}

// Section 10: a pure status change, no reply attached (e.g. moving a complaint
// to in_review while the admin looks into it, or closing an answered one).
// This deliberately touches ONLY `status` - it never sets `respondedAt` /
// `adminResponse` / `respondedByAdminId`, so changing the status of an
// unanswered complaint leaves it unanswered and a later respondToComplaint
// still passes the `respondedAt: null` atomic guard.
async function updateComplaintStatus(complaintId, adminUserId, status) {
  assertValidStatus(status);
  const complaint = await loadComplaintOrThrow(complaintId);
  if (complaint.status === status) return complaint;

  complaint.status = status;
  await complaint.save();

  emitUpdated(complaint);
  return complaint;
}

module.exports = {
  listComplaints,
  getComplaint,
  respondToComplaint,
  updateComplaintStatus,
  getStatusCounts,
};
