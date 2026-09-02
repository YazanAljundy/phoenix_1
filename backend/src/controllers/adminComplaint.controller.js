const { asyncHandler } = require('../utils/asyncHandler');
const adminComplaintService = require('../services/adminComplaint.service');
const complaintViewModel = require('../viewmodels/complaint.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

const ADMIN_COMPLAINTS_DEFAULT_LIMIT = 20;

const list = asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  const { limit, after } = parseCursorQuery(req.query, ADMIN_COMPLAINTS_DEFAULT_LIMIT);
  const cursor = parseObjectIdCursor(after);

  const { rows, hasMore, nextCursor, counts } = await adminComplaintService.listComplaints({
    status,
    limit,
    after: cursor,
  });
  res.json({
    success: true,
    ...complaintViewModel.toAdminComplaintListResponse(rows, counts),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await adminComplaintService.getComplaint(req.params.id);
  res.json({ success: true, ...complaintViewModel.toAdminComplaintResponse(row) });
});

const respond = asyncHandler(async (req, res) => {
  await adminComplaintService.respondToComplaint(req.params.id, req.user._id, {
    response: req.body.response,
    status: typeof req.body.status === 'string' && req.body.status ? req.body.status : undefined,
  });
  const row = await adminComplaintService.getComplaint(req.params.id);
  res.json({
    success: true,
    message: 'Response sent.',
    ...complaintViewModel.toAdminComplaintResponse(row),
  });
});

const updateStatus = asyncHandler(async (req, res) => {
  await adminComplaintService.updateComplaintStatus(req.params.id, req.user._id, req.body.status);
  const row = await adminComplaintService.getComplaint(req.params.id);
  res.json({
    success: true,
    message: 'Status updated.',
    ...complaintViewModel.toAdminComplaintResponse(row),
  });
});

module.exports = { list, getOne, respond, updateStatus };
