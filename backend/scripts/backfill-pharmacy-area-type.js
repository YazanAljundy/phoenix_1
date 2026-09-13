// One-time backfill: pharmacy.model.js's areaType is about to move from
// optional (enum, no `required`) to `required: true`. It was added after
// plenty of pharmacies already existed, so any row created before that point
// - or any row whose value somehow fell outside the three allowed enum
// values - has none. Flipping the schema to `required: true` while such rows
// exist would only surface as a crash the next time something re-saves one
// of them in full (warehouseReview.service.js's createPharmacyReview does
// exactly that on every new warehouse->pharmacy rating), so this must run
// and reach zero missing rows BEFORE that schema change ships.
//
// Every affected row is set to 'city' - not a guess at the real value, just
// the safest of the three to default an unknown legacy row to (matches
// auth.service.js's own city: 'Latakia' default for the same "we never
// collected this from old pharmacies" situation). Anyone who needs the
// correct value for a specific pharmacy can still edit it after the fact.
//
// Safe to re-run: it only ever touches rows currently missing/invalid, so a
// second run finds nothing left to do and reports 0.
//
// Usage:
//   node scripts/backfill-pharmacy-area-type.js [--dry-run]
//   npm run backfill-pharmacy-area-type -- --dry-run
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Pharmacy = require('../src/models/pharmacy.model');

const ALLOWED_AREA_TYPES = ['city', 'city_ring', 'rural'];
const DEFAULT_AREA_TYPE = 'city';
const DRY_RUN = process.argv.includes('--dry-run');

// Missing (absent/null/undefined) OR present but outside the enum - the
// schema's `enum` only ever rejected a bad value on *write*, so a row could
// in principle have gotten one another way (a direct DB edit, an older bug).
// Both cases are "not a valid areaType today" and get the same treatment.
const MISSING_OR_INVALID_FILTER = {
  $or: [
    { areaType: { $exists: false } },
    { areaType: null },
    { areaType: { $nin: ALLOWED_AREA_TYPES } },
  ],
};

async function main() {
  await mongoose.connect(env.mongodbUri);

  const totalPharmacies = await Pharmacy.countDocuments({});
  const beforeCount = await Pharmacy.countDocuments(MISSING_OR_INVALID_FILTER);

  console.log(`Connected. ${totalPharmacies} pharmacy document(s) total.`);
  console.log(`${beforeCount} pharmacy document(s) missing a valid areaType before this run.`);

  if (beforeCount === 0) {
    console.log('Nothing to do - every pharmacy already has a valid areaType.');
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log(`Dry run - would set areaType = '${DEFAULT_AREA_TYPE}' on ${beforeCount} document(s). No writes made.`);
    await mongoose.disconnect();
    return;
  }

  const result = await Pharmacy.updateMany(MISSING_OR_INVALID_FILTER, {
    $set: { areaType: DEFAULT_AREA_TYPE },
  });

  const afterCount = await Pharmacy.countDocuments(MISSING_OR_INVALID_FILTER);

  console.log(`Matched ${result.matchedCount}, modified ${result.modifiedCount} document(s).`);
  console.log(`${afterCount} pharmacy document(s) still missing a valid areaType after this run.`);
  if (afterCount > 0) {
    console.error('Backfill incomplete - do NOT proceed to make areaType required at the schema level yet.');
    process.exitCode = 1;
  } else {
    console.log('Backfill complete - every pharmacy now has a valid areaType.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
