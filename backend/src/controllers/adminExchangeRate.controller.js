const { asyncHandler } = require('../utils/asyncHandler');
const exchangeRateService = require('../services/exchangeRate.service');
const exchangeRateViewModel = require('../viewmodels/exchangeRate.viewmodel');
const { parseCursorQuery, parseObjectIdCursor, paginationMeta } = require('../utils/pagination');

// Unlike the public endpoint, this always returns 200 - even with no rate
// stored yet - so the panel can render the card in an empty state and let
// the admin type in a first rate right away.
const getRate = asyncHandler(async (req, res) => {
  const rate = await exchangeRateService.getRate();
  res.json({ success: true, ...exchangeRateViewModel.toAdminExchangeRateResponse(rate) });
});

// Money-Flow V2: the acting admin is passed through so exchangeRate.service
// can name them in the audit trail. The validation itself is unchanged - any
// positive rate is still accepted, with no bounds check (product owner's call).
const setManualRate = asyncHandler(async (req, res) => {
  const rate = await exchangeRateService.setManualRate(req.body.usdToSyp, req.user._id);
  res.json({ success: true, ...exchangeRateViewModel.toAdminExchangeRateResponse(rate) });
});

// The append-only history behind the current rate, newest first - cursor-
// paginated the same way every other "Load more" list in the panel is.
const listHistory = asyncHandler(async (req, res) => {
  const { limit, after } = parseCursorQuery(req.query, 20);
  const cursor = parseObjectIdCursor(after);
  const { rows, hasMore, nextCursor } = await exchangeRateService.listRateHistory({ limit, after: cursor });
  res.json({
    success: true,
    history: rows.map((row) => ({
      id: row._id,
      usdToSyp: row.usdToSyp,
      previousUsdToSyp: row.previousUsdToSyp,
      source: row.source,
      effectiveFrom: row.effectiveFrom,
    })),
    pagination: paginationMeta(hasMore, nextCursor),
  });
});

const resetToApi = asyncHandler(async (req, res) => {
  const rate = await exchangeRateService.resetToApi();
  res.json({ success: true, ...exchangeRateViewModel.toAdminExchangeRateResponse(rate) });
});

module.exports = { getRate, setManualRate, resetToApi, listHistory };
