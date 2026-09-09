const { asyncHandler } = require('../utils/asyncHandler');
const warehouseService = require('../services/warehouse.service');
const warehouseViewModel = require('../viewmodels/warehouse.viewmodel');

const list = asyncHandler(async (req, res) => {
  // `all` is the default, not `mine`, and deliberately so: app builds already
  // in pharmacists' hands don't send this param and have no "view all cities"
  // toggle to escape a narrowed list with. The city-filtered *default* is a
  // property of the new screen (which sends cityScope=mine on first load),
  // not of the endpoint - so an old client keeps seeing exactly what it
  // always saw. Anything other than the two known values reads as `all`
  // rather than erroring, for the same reason.
  const cityScope =
    req.query.cityScope === warehouseService.CITY_SCOPE_MINE
      ? warehouseService.CITY_SCOPE_MINE
      : warehouseService.CITY_SCOPE_ALL;

  // The pharmacy's own city is resolved server-side from the authenticated
  // user rather than accepted from the client: the route is pharmacy-only, a
  // pharmacist can only ever ask for their own city, and a client-sent city
  // could be stale against a profile the admin has since corrected.
  const result = await warehouseService.listAvailableWarehouses({
    cityScope,
    pharmacyUserId: req.user._id,
  });
  res.json({ success: true, ...warehouseViewModel.toWarehouseListResponse(result) });
});

const profile = asyncHandler(async (req, res) => {
  const data = await warehouseService.getWarehouseProfile(req.params.warehouseId);
  res.json({ success: true, ...warehouseViewModel.toWarehouseProfileResponse(data) });
});

module.exports = { list, profile };
