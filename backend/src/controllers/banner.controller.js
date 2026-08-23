const { asyncHandler } = require('../utils/asyncHandler');
const bannerService = require('../services/banner.service');
const bannerViewModel = require('../viewmodels/banner.viewmodel');

const listActive = asyncHandler(async (req, res) => {
  const banners = await bannerService.listActiveBanners();
  res.json({ success: true, ...bannerViewModel.toActiveBannersResponse(banners) });
});

module.exports = { listActive };
