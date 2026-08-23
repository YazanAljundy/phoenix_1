const mongoose = require('mongoose');
const { ApiError } = require('./ApiError');

// Shared cursor-pagination helpers for the larger list endpoints. The cursor
// itself is always the value of whichever field the endpoint sorts by (an
// ObjectId for `_id`, a plain number for `orderNumber`) - it must be a
// unique, stable sort key or the cursor can skip or repeat rows across pages.

function parseCursorQuery(query, defaultLimit) {
  const rawLimit = query.limit;
  const limit = rawLimit === undefined ? defaultLimit : Number(rawLimit);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw ApiError.badRequest('Invalid limit.', undefined, 'INVALID_LIMIT');
  }
  const after = typeof query.after === 'string' && query.after.trim() ? query.after.trim() : null;
  return { limit, after };
}

// For endpoints paginating on an ObjectId field (`_id`).
function parseObjectIdCursor(after) {
  if (after === null) return null;
  if (!mongoose.Types.ObjectId.isValid(after)) {
    throw ApiError.badRequest('Invalid cursor.', undefined, 'INVALID_CURSOR');
  }
  return after;
}

// For endpoints paginating on a numeric field (`orderNumber`).
function parseNumericCursor(after) {
  if (after === null) return null;
  const value = Number(after);
  if (!Number.isFinite(value)) {
    throw ApiError.badRequest('Invalid cursor.', undefined, 'INVALID_CURSOR');
  }
  return value;
}

function paginationMeta(hasMore, nextCursor) {
  return { hasMore, nextCursor: hasMore ? nextCursor : null };
}

module.exports = { parseCursorQuery, parseObjectIdCursor, parseNumericCursor, paginationMeta };
