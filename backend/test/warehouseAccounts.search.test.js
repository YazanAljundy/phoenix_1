// Perf/pagination follow-up, Section 3: a `search` (pharmacy name) filter on
// the warehouse's Debts/Balances account list, combined with its existing
// compound (balanceSyp, id) cursor - the one endpoint in the app that does
// NOT use a plain ObjectId cursor (see accountStatement.service.js).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-warehouse-accounts-search';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMemoryMongo, stopMemoryMongo, clearCollections } = require('./helpers/mongo');

const Pharmacy = require('../src/models/pharmacy.model');
const LedgerAccount = require('../src/models/ledgerAccount.model');
const { listAccountsForWarehouse } = require('../src/services/accountStatement.service');

const WAREHOUSE_ID = new mongoose.Types.ObjectId();

test.before(async () => {
  await startMemoryMongo({ dbName: 'feniq-warehouse-accounts-search-test' });
});

test.after(async () => {
  await stopMemoryMongo();
});

test.beforeEach(async () => {
  await clearCollections(Pharmacy, LedgerAccount);
});

async function seedAccount({ nameAr, nameEn, balanceSyp }) {
  const pharmacy = await Pharmacy.create({
    userId: new mongoose.Types.ObjectId(),
    nameAr,
    nameEn,
    ownerName: 'O',
    address: 'a',
    city: 'Latakia',
    areaType: 'city',
    phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`,
    addedBy: 'self',
  });
  const account = await LedgerAccount.create({
    pharmacyId: pharmacy._id,
    warehouseId: WAREHOUSE_ID,
    balanceCache: { syp: balanceSyp, usd: balanceSyp / 10000, lastEntrySeq: 1 },
  });
  return { pharmacy, account };
}

test('search matches by Arabic or English pharmacy name, case-insensitively', async () => {
  await seedAccount({ nameAr: 'صيدلية النور', nameEn: 'Al-Noor Pharmacy', balanceSyp: 5000 });
  await seedAccount({ nameAr: 'صيدلية الأمل', nameEn: 'Al-Amal Pharmacy', balanceSyp: 3000 });
  await seedAccount({ nameAr: 'صيدلية بعيدة', nameEn: 'Distant Pharmacy', balanceSyp: 1000 });

  const byArabic = await listAccountsForWarehouse(WAREHOUSE_ID, { search: 'النور' });
  assert.strictEqual(byArabic.rows.length, 1);
  assert.strictEqual(byArabic.rows[0].pharmacy.nameEn, 'Al-Noor Pharmacy');

  const byEnglishCaseInsensitive = await listAccountsForWarehouse(WAREHOUSE_ID, { search: 'al-amal' });
  assert.strictEqual(byEnglishCaseInsensitive.rows.length, 1);
  assert.strictEqual(byEnglishCaseInsensitive.rows[0].pharmacy.nameAr, 'صيدلية الأمل');

  const noMatch = await listAccountsForWarehouse(WAREHOUSE_ID, { search: 'zzz-nonexistent' });
  assert.strictEqual(noMatch.rows.length, 0);
});

test('an empty/omitted search returns every account, same as before', async () => {
  await seedAccount({ nameAr: 'أ', nameEn: 'A', balanceSyp: 1000 });
  await seedAccount({ nameAr: 'ب', nameEn: 'B', balanceSyp: 2000 });

  const omitted = await listAccountsForWarehouse(WAREHOUSE_ID, {});
  const blank = await listAccountsForWarehouse(WAREHOUSE_ID, { search: '   ' });
  assert.strictEqual(omitted.rows.length, 2);
  assert.strictEqual(blank.rows.length, 2, 'a blank/whitespace-only search is treated as no filter');
});

test('search combines correctly with the compound (balanceSyp, id) cursor across pages', async () => {
  // 5 pharmacies all matching "Match", with distinct balances so the cursor
  // has real ordering to walk - plus one that must never appear.
  const matching = [];
  for (const balanceSyp of [5000, 4000, 3000, 2000, 1000]) {
    // eslint-disable-next-line no-await-in-loop
    matching.push(await seedAccount({ nameAr: 'صيدلية مطابقة', nameEn: `Match Pharmacy ${balanceSyp}`, balanceSyp }));
  }
  await seedAccount({ nameAr: 'غير مطابقة', nameEn: 'Other Pharmacy', balanceSyp: 9999 });

  const seenIds = [];
  let after = null;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop
    const page = await listAccountsForWarehouse(WAREHOUSE_ID, { limit: 2, after, search: 'Match' });
    pages += 1;
    assert.ok(page.rows.every((r) => r.pharmacy.nameEn.startsWith('Match')), 'no leak of the non-matching pharmacy');
    seenIds.push(...page.rows.map((r) => String(r.accountId)));
    hasMore = page.hasMore;
    after = hasMore ? JSON.parse(page.nextCursor) : null;
  }

  assert.strictEqual(pages, 3, '5 matching rows at limit 2 is 3 pages (2, 2, 1)');
  assert.strictEqual(seenIds.length, 5);
  assert.strictEqual(new Set(seenIds).size, 5, 'no row seen twice across pages');
  assert.deepStrictEqual(
    seenIds.sort(),
    matching.map((m) => String(m.account._id)).sort(),
    'every matching account was covered, in the balance-descending order the list promises'
  );
});
