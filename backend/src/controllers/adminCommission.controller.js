const { asyncHandler } = require('../utils/asyncHandler');
const service = require('../services/commissionCollection.service');
const viewModel = require('../viewmodels/commissionCollection.viewmodel');
const { parseCursorQuery, parseObjectIdCursor } = require('../utils/pagination');

// The platform's side of commission: who owes what, and recording when a
// warehouse pays. Admin-only by the router-level authorize('admin') - a
// warehouse sees its own Settlement tab and nothing else.

// Every warehouse's commission position for one admin-chosen range, most-owing
// first. The same per-warehouse settlement computation the warehouse's own tab
// uses, run across all of them, plus the collection layer.
const overview = asyncHandler(async (req, res) => {
  const data = await service.getCommissionOverview({
    from: req.query.from,
    to: req.query.to,
  });
  res.json({ success: true, ...viewModel.toOverviewResponse(data) });
});

// One warehouse: its figures, the per-order breakdown behind them, and its
// collection history - cursor-paginated (Section 1.3), same limit/after
// pattern as every other "Load more" list. Default limit kept at 100 (was a
// flat cap of the same size) rather than the usual 20 - a collection row is a
// single compact line, and 100 was already what admins saw with no control
// over it at all.
const warehouseDetail = asyncHandler(async (req, res) => {
  const { limit, after } = parseCursorQuery(req.query, 100);
  const cursor = parseObjectIdCursor(after);
  const data = await service.getWarehouseCommissionDetail(req.params.warehouseId, {
    from: req.query.from,
    to: req.query.to,
    limit,
    after: cursor,
  });
  res.json({ success: true, ...viewModel.toWarehouseDetailResponse(data) });
});

const recordCollection = asyncHandler(async (req, res) => {
  const collection = await service.recordCollection({
    warehouseId: req.body.warehouseId,
    periodFrom: req.body.periodFrom,
    periodTo: req.body.periodTo,
    amountSyp: req.body.amountSyp,
    method: req.body.method,
    reference: req.body.reference,
    note: req.body.note,
    actorId: req.user._id,
  });
  res.status(201).json({
    success: true,
    message: 'Collection recorded.',
    ...viewModel.toCollectionResponse(collection),
  });
});

// Undoes a collection recorded in error. The row is kept - reversing is how a
// mistake is corrected everywhere in Money-Flow V2.
const reverseCollection = asyncHandler(async (req, res) => {
  const collection = await service.reverseCollection({
    collectionId: req.params.id,
    reason: req.body.reason,
    actorId: req.user._id,
  });
  res.json({
    success: true,
    message: 'Collection reversed.',
    ...viewModel.toCollectionResponse(collection),
  });
});

module.exports = { overview, warehouseDetail, recordCollection, reverseCollection };
