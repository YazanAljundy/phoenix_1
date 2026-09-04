const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');

// Section: the warehouse's own settings it is allowed to change itself -
// currently the order-size limits (warehouse.model.js's minOrderAmountUsd/
// maxOrderAmountUsd) plus the requireDeliverySealPhoto toggle. Deliberately a
// narrow update - only these fields are writable here, so this endpoint can
// never be used to edit the name/rates/anything else the admin owns.

// `undefined` means "not sent", which leaves the stored value untouched.
// An explicit null/'' clears the maximum ("no maximum"); the minimum has no
// null state - 0 is its "no minimum".
function parseAmount(value, field, code, { nullable }) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    if (nullable) return null;
    throw ApiError.badRequest(`${field} is required.`, undefined, code);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw ApiError.badRequest(`${field} must be a number of 0 or more.`, undefined, code);
  }
  // Money: two decimals, same rounding the rest of the USD figures use.
  return Math.round(amount * 100) / 100;
}

async function getSettings(warehouseId) {
  const warehouse = await Warehouse.findById(warehouseId);
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

async function updateOrderLimits(
  warehouseId,
  { minOrderAmountUsd, maxOrderAmountUsd, requireDeliverySealPhoto }
) {
  const warehouse = await getSettings(warehouseId);

  const nextMin = parseAmount(minOrderAmountUsd, 'Minimum order amount', 'INVALID_MIN_ORDER_AMOUNT', {
    nullable: false,
  });
  const nextMax = parseAmount(maxOrderAmountUsd, 'Maximum order amount', 'INVALID_MAX_ORDER_AMOUNT', {
    nullable: true,
  });

  // Validated against the values that will actually be stored (the incoming
  // one where sent, the existing one otherwise) - not just against each
  // other, so sending only one of the two can't create an inverted pair.
  const effectiveMin = nextMin === undefined ? warehouse.minOrderAmountUsd : nextMin;
  const effectiveMax = nextMax === undefined ? warehouse.maxOrderAmountUsd : nextMax;
  if (effectiveMin > 0 && effectiveMax !== null && effectiveMin >= effectiveMax) {
    throw ApiError.badRequest(
      'The minimum order amount must be lower than the maximum.',
      undefined,
      'INVALID_ORDER_LIMITS'
    );
  }

  if (nextMin !== undefined) warehouse.minOrderAmountUsd = nextMin;
  if (nextMax !== undefined) warehouse.maxOrderAmountUsd = nextMax;

  // `undefined` = not sent, leave as-is; anything else is coerced to a plain
  // boolean so the client can never store a non-boolean into this flag.
  if (requireDeliverySealPhoto !== undefined) {
    warehouse.requireDeliverySealPhoto = Boolean(requireDeliverySealPhoto);
  }

  await warehouse.save();

  return warehouse;
}

module.exports = { getSettings, updateOrderLimits };
