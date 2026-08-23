const Banner = require('../models/banner.model');

// Section: banners shown across the app (any logged-in user, not just
// pharmacists) - approved and currently within [startDate, endDate]. No cron
// job flips an expired banner off; this same live date-range filter is the
// only thing that ever hides one, on every read.
async function listActiveBanners() {
  const now = new Date();
  return Banner.find({
    status: 'approved',
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).sort({ createdAt: -1 });
}

module.exports = { listActiveBanners };
