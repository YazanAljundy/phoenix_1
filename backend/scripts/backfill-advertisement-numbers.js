// One-time backfill: advertisements now carry a sequential advertisementNumber
// (used as the reference in the WhatsApp conversation with the admin about
// publishing/payment - see warehouseAdvertisement.service.js). Rows created
// before this field existed have none; the service assigns one lazily on the
// next edit, and this script does the whole collection at once so every
// existing advertisement shows a number without being touched first.
//
// Safe to run more than once - it only fills rows that are still missing a
// number, and seeds the counter above the current maximum.
//
// Usage: node scripts/backfill-advertisement-numbers.js
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Advertisement = require('../src/models/advertisement.model');
const Counter = require('../src/models/counter.model');

async function main() {
  await mongoose.connect(env.mongodbUri);

  const existingMax = await Advertisement.find({ advertisementNumber: { $ne: null } })
    .sort({ advertisementNumber: -1 })
    .limit(1)
    .select('advertisementNumber')
    .lean();
  let next = (existingMax[0]?.advertisementNumber ?? 0) + 1;

  // Oldest first, so numbers follow creation order.
  const missing = await Advertisement.find({ advertisementNumber: null }).sort({ createdAt: 1 });
  for (const advertisement of missing) {
    advertisement.advertisementNumber = next;
    await advertisement.save();
    next += 1;
  }

  await Counter.findOneAndUpdate(
    { _id: 'advertisement_number' },
    { $max: { seq: next - 1 } },
    { upsert: true }
  );

  console.log(`Backfilled ${missing.length} advertisement number(s). Counter now at ${next - 1}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
