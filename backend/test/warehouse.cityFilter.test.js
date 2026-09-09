// Section: warehouses-by-city.
//
// The pharmacy app's warehouse screen opens pre-filtered to the pharmacy's own
// city, with a "view all cities" escape hatch. These tests pin the two halves
// that make that safe:
//
//  1. The matcher (utils/cityMatch.js), because the two sides of the
//     comparison come from unrelated, uncontrolled sources - a pharmacy's city
//     is the ASCII literal auth.service.js hardcodes, a warehouse's is
//     whatever an admin typed into a free-text input. 'Latakia' must match
//     'اللاذقية' or the filter empties the screen.
//  2. The scope plumbing (warehouse.service.js), including the two fallbacks
//     that must never leave a pharmacist staring at an empty list: an
//     unrecognised scope, and a pharmacy whose own city is unusable.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-city-filter-tests';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Pharmacy = require('../src/models/pharmacy.model');

const warehouseService = require('../src/services/warehouse.service');
const warehouseViewModel = require('../src/viewmodels/warehouse.viewmodel');
const { normalizeCity, canonicalCity, citiesMatch } = require('../src/utils/cityMatch');

// --- the matcher, in isolation -------------------------------------------
// No database involved: these are the string rules everything below rests on.

test('canonicalCity resolves every expected spelling of one city to one key', () => {
  const latakia = canonicalCity('Latakia');
  assert.ok(latakia, 'the pharmacy-side literal must resolve to something');
  for (const spelling of ['latakia', '  LATAKIA  ', 'Lattakia', 'Al-Ladhiqiyah', 'اللاذقية', 'لاذقية']) {
    assert.strictEqual(canonicalCity(spelling), latakia, `${spelling} must canonicalize like Latakia`);
  }
});

test('citiesMatch bridges the Latin/Arabic gap the two data sources create', () => {
  // The single most important case in this file: every pharmacy on the
  // platform stores 'Latakia' (auth.service.js), and an admin onboarding a
  // warehouse is at least as likely to type the Arabic name.
  assert.ok(citiesMatch('Latakia', 'اللاذقية'));
  assert.ok(citiesMatch('اللاذقية', 'Latakia'));
  assert.ok(citiesMatch('Aleppo', 'حلب'));
  assert.ok(citiesMatch('Deir ez-Zor', 'دير الزور'));
});

test('citiesMatch ignores case, padding, diacritics and the definite article', () => {
  assert.ok(citiesMatch('Latakia', ' lAtAkIa '));
  assert.ok(citiesMatch('اللاذقية', 'لاذقيّة'), 'harakat must not split one city into two');
  assert.ok(citiesMatch('حماة', 'حماه'), 'ta marbuta and ha must converge');
  assert.ok(citiesMatch('الرقة', 'رقة'), 'the leading article must not split one city into two');
});

test('citiesMatch keeps genuinely different cities apart', () => {
  assert.ok(!citiesMatch('Latakia', 'Aleppo'));
  assert.ok(!citiesMatch('Latakia', 'دمشق'));
  assert.ok(!citiesMatch('حلب', 'حمص'));
});

test('a city outside the alias table still matches itself, but nothing else', () => {
  // The table cannot enumerate every place an admin might type, so the
  // fallback has to be "its own normalized form" - never a catch-all bucket
  // that would quietly group unrelated cities together.
  assert.ok(citiesMatch('Jableh', ' jableh '));
  assert.ok(!citiesMatch('Jableh', 'Safita'));
  assert.strictEqual(canonicalCity('Jableh'), normalizeCity('Jableh'));
});

test('an empty or non-string city matches nothing, including another empty one', () => {
  for (const empty of ['', '   ', null, undefined, 42, {}]) {
    assert.ok(!citiesMatch(empty, 'Latakia'), `${String(empty)} must not match a real city`);
    assert.ok(!citiesMatch('Latakia', empty), `a real city must not match ${String(empty)}`);
    assert.ok(!citiesMatch(empty, empty), 'two blanks must not be treated as the same city');
  }
});

// --- the endpoint's scope plumbing ---------------------------------------

const HOME_CITY_WAREHOUSE_ID = new mongoose.Types.ObjectId();
const ARABIC_CITY_WAREHOUSE_ID = new mongoose.Types.ObjectId();
const OTHER_CITY_WAREHOUSE_ID = new mongoose.Types.ObjectId();
const PHARMACY_USER_ID = new mongoose.Types.ObjectId();
const CITYLESS_PHARMACY_USER_ID = new mongoose.Types.ObjectId();

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-city-filter-test' });

  const homeUserId = new mongoose.Types.ObjectId();
  const arabicUserId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  const pausedUserId = new mongoose.Types.ObjectId();

  await User.create([
    { _id: homeUserId, name: 'Home WH', phone: '0915000001', role: 'warehouse', status: 'active' },
    { _id: arabicUserId, name: 'Arabic WH', phone: '0915000002', role: 'warehouse', status: 'active' },
    { _id: otherUserId, name: 'Other WH', phone: '0915000003', role: 'warehouse', status: 'active' },
    { _id: pausedUserId, name: 'Paused WH', phone: '0915000004', role: 'warehouse', status: 'active' },
    { _id: PHARMACY_USER_ID, name: 'Pharm', phone: '0915000005', role: 'pharmacy', status: 'active' },
    { _id: CITYLESS_PHARMACY_USER_ID, name: 'Cityless', phone: '0915000006', role: 'pharmacy', status: 'active' },
  ]);

  await Warehouse.create([
    {
      _id: HOME_CITY_WAREHOUSE_ID, userId: homeUserId, nameAr: 'أ', nameEn: 'A Home City',
      address: 'r', city: 'Latakia', phone: '0945000001', isActive: true,
    },
    {
      // The case the whole normalizer exists for: same city as the pharmacy,
      // spelled the way an admin would actually type it.
      _id: ARABIC_CITY_WAREHOUSE_ID, userId: arabicUserId, nameAr: 'ب', nameEn: 'B Arabic Spelling',
      address: 'r', city: '  اللاذقية ', phone: '0945000002', isActive: true,
    },
    {
      _id: OTHER_CITY_WAREHOUSE_ID, userId: otherUserId, nameAr: 'ج', nameEn: 'C Other City',
      address: 'r', city: 'Aleppo', phone: '0945000003', isActive: true,
    },
    {
      // Paused, and in the pharmacy's own city - proves the city filter is
      // layered on top of the availability rule rather than replacing it.
      userId: pausedUserId, nameAr: 'د', nameEn: 'D Paused', address: 'r',
      city: 'Latakia', phone: '0945000004', isActive: false,
    },
  ]);

  await Pharmacy.create([
    {
      userId: PHARMACY_USER_ID, nameAr: 'ص', nameEn: 'Pharmacy', ownerName: 'Owner',
      address: 'a', city: 'Latakia', phone: '0935000001', addedBy: 'self',
    },
    {
      userId: CITYLESS_PHARMACY_USER_ID, nameAr: 'ص2', nameEn: 'Cityless Pharmacy', ownerName: 'Owner',
      address: 'a', city: '   ', phone: '0935000002', addedBy: 'self',
    },
  ]);
});

test.after(async () => {
  await stopMemoryMongo();
});

const idsOf = (result) => result.warehouses.map((w) => String(w._id)).sort();

test('cityScope=mine returns only the same-city warehouses, across spellings', async () => {
  const result = await warehouseService.listAvailableWarehouses({
    cityScope: 'mine',
    pharmacyUserId: PHARMACY_USER_ID,
  });

  assert.deepStrictEqual(
    idsOf(result),
    [String(HOME_CITY_WAREHOUSE_ID), String(ARABIC_CITY_WAREHOUSE_ID)].sort(),
    'both Latakia warehouses must survive the filter regardless of spelling'
  );
  assert.strictEqual(result.cityFilterApplied, true);
  assert.strictEqual(result.pharmacyCity, 'Latakia');
});

test('cityScope=all returns every available warehouse', async () => {
  const result = await warehouseService.listAvailableWarehouses({
    cityScope: 'all',
    pharmacyUserId: PHARMACY_USER_ID,
  });

  assert.deepStrictEqual(
    idsOf(result),
    [String(HOME_CITY_WAREHOUSE_ID), String(ARABIC_CITY_WAREHOUSE_ID), String(OTHER_CITY_WAREHOUSE_ID)].sort()
  );
  assert.strictEqual(result.cityFilterApplied, false);
});

test('the default scope is unfiltered, so an old client keeps its old list', async () => {
  // Load-bearing: app builds already installed do not send cityScope and have
  // no toggle to escape a narrowed list with.
  const result = await warehouseService.listAvailableWarehouses();
  assert.strictEqual(result.warehouses.length, 3);
  assert.strictEqual(result.cityFilterApplied, false);
});

test('the city filter never resurrects a paused or unapproved warehouse', async () => {
  const result = await warehouseService.listAvailableWarehouses({
    cityScope: 'mine',
    pharmacyUserId: PHARMACY_USER_ID,
  });
  assert.ok(
    !result.warehouses.some((w) => w.nameEn === 'D Paused'),
    'isActive:false must still exclude it even though its city matches'
  );
});

test('a pharmacy with no usable city falls back to the full list, and says so', async () => {
  const result = await warehouseService.listAvailableWarehouses({
    cityScope: 'mine',
    pharmacyUserId: CITYLESS_PHARMACY_USER_ID,
  });

  assert.strictEqual(result.warehouses.length, 3, 'an unusable city must not empty the screen');
  assert.strictEqual(
    result.cityFilterApplied,
    false,
    'the app must be told the narrowing did not happen so it can hide the toggle'
  );
});

test('the existing sort order carries over unchanged through the filter', async () => {
  const result = await warehouseService.listAvailableWarehouses({
    cityScope: 'mine',
    pharmacyUserId: PHARMACY_USER_ID,
  });
  assert.deepStrictEqual(
    result.warehouses.map((w) => w.nameEn),
    ['A Home City', 'B Arabic Spelling'],
    'filtering must preserve the nameEn sort, not reorder'
  );
});

test('the list response carries the filter flags the app reads', async () => {
  const result = await warehouseService.listAvailableWarehouses({
    cityScope: 'mine',
    pharmacyUserId: PHARMACY_USER_ID,
  });
  const payload = warehouseViewModel.toWarehouseListResponse(result);

  assert.deepStrictEqual(Object.keys(payload).sort(), ['cityFilterApplied', 'pharmacyCity', 'warehouses']);
  assert.strictEqual(payload.cityFilterApplied, true);
  assert.strictEqual(payload.pharmacyCity, 'Latakia');
  // The card shape itself must be untouched by this feature.
  assert.deepStrictEqual(
    Object.keys(payload.warehouses[0]).sort(),
    ['city', 'id', 'logo', 'maxOrderAmountUsd', 'minOrderAmountUsd', 'nameAr', 'nameEn', 'phone'].sort()
  );
});
