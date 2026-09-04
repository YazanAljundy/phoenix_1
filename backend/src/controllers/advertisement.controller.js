const { asyncHandler } = require('../utils/asyncHandler');
const advertisementService = require('../services/advertisement.service');
const advertisementViewModel = require('../viewmodels/advertisement.viewmodel');

const listActive = asyncHandler(async (req, res) => {
  const rows = await advertisementService.listActiveAdvertisements();
  res.json({ success: true, ...advertisementViewModel.toActiveAdvertisementsResponse(rows) });
});

// Builds a cart payload from an advertisement. Creates NOTHING - no order, no
// document, same as the reorder endpoint it is shaped after. Every price in
// the response is read from the database; createOrder re-reads all of them
// again at checkout and never trusts what comes back from the client.
const cart = asyncHandler(async (req, res) => {
  const preparation = await advertisementService.prepareAdvertisementCart(req.params.id);
  res.json({ success: true, ...advertisementViewModel.toAdvertisementCartResponse(preparation) });
});

module.exports = { listActive, cart };
