const Banner = require('../models/banner.model');

// Section: banners shown across the app (any logged-in user, not just
// pharmacists) - approved and currently within [startDate, endDate]. No cron
// job flips an expired banner off; this same live date-range filter is the
// only thing that ever hides one, on every read.
async function listActiveBanners() {
  const now = new Date();
  // .lean(): read-only, straight into banner.viewmodel.js.
  // .select(): banner.viewmodel.js's serializeActiveBanner emits exactly these
  // five fields - status/startDate/endDate are the filter, not part of the
  // slide, and title/bannerNumber/rejectionNote/approvedBy/createdBy/timestamps
  // are never read on this path.
  return Banner.find({
    status: 'approved',
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .select('imageUrl productId manufacturerAr warehouseId')
    .sort({ createdAt: -1 })
    .lean();
}

module.exports = { listActiveBanners };
