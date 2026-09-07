#!/usr/bin/env node
// Money-Flow V2 - start the development database clean.
//
//   node backend/scripts/reset-dev-db.js --yes
//   node backend/scripts/reset-dev-db.js --yes --keep-rate
//
// V2 changed the shape of financial data substantially: orders and payments
// now freeze their exchange rate, delivered orders carry an invoice number,
// balances live in an immutable ledger rather than a recomputed cache, and
// returns credit an account instead of spawning a replacement order. Rows
// written before that have none of it.
//
// In a development environment the honest fix is a clean start: this drops the
// database and rebuilds the indexes the financial guarantees depend on (one
// charge per order, one credit per return, one reversal per entry, unique
// idempotency keys). It is deliberately NOT a migration - it destroys data.
//
// If a machine DOES hold seeded data worth keeping, don't run this: the
// simplest path there is a small script that walks delivered orders and
// payments and posts an opening `charge` / `payment` entry for each through
// ledger.postEntry. Nothing in V2 requires the two paths to agree, because
// nothing downstream reads the old cache once the ledger exists.
require('dotenv').config();
const readline = require('node:readline/promises');
const mongoose = require('mongoose');

const env = require('../src/config/env');
const { supportsTransactions } = require('../src/utils/transaction');
const { ensureFinancialIndexes } = require('../src/services/ledger.service');

// Every model, so a reset also rebuilds the non-financial indexes rather than
// leaving them to be created lazily under the first request.
require('../src/models/user.model');
require('../src/models/pharmacy.model');
require('../src/models/warehouse.model');
require('../src/models/product.model');
require('../src/models/productCatalog.model');
require('../src/models/order.model');
require('../src/models/orderItem.model');
require('../src/models/payment.model');
require('../src/models/return.model');
require('../src/models/ledgerAccount.model');
require('../src/models/ledgerEntry.model');
require('../src/models/financialAuditLog.model');
require('../src/models/exchangeRate.model');
require('../src/models/exchangeRateHistory.model');
require('../src/models/counter.model');

const ExchangeRate = mongoose.model('ExchangeRate');

async function confirm(dbName, host) {
  if (process.argv.includes('--yes')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nThis DROPS the database "${dbName}" on ${host}.\nType the database name to confirm: `
  );
  rl.close();
  return answer.trim() === dbName;
}

async function main() {
  const uri = env.mongodbUri;

  // A remote host is almost certainly not a dev machine. Refuse outright
  // rather than relying on the operator reading the prompt carefully.
  if (!/(localhost|127\.0\.0\.1)/.test(uri)) {
    console.error('Refusing to reset a non-local database:');
    console.error(`  ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
    console.error('This script is for local development only.');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri);
  const dbName = mongoose.connection.name;
  const host = mongoose.connection.host + ':' + mongoose.connection.port;

  if (!(await confirm(dbName, host))) {
    console.log('Aborted - nothing was dropped.');
    await mongoose.disconnect();
    return;
  }

  // Worth preserving across a reset: without a rate, no order can be priced at
  // all, so a cleared one just means the first thing anyone hits is an error.
  let rate = null;
  if (process.argv.includes('--keep-rate')) {
    rate = await ExchangeRate.findById('singleton').lean();
  }

  await mongoose.connection.dropDatabase();
  console.log(`Dropped "${dbName}".`);

  // Rebuilt deliberately rather than lazily: the unique financial indexes are
  // load-bearing guarantees, and a transaction that races their background
  // build sees spurious write conflicts (see ledger.service.js).
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).createIndexes()));
  await ensureFinancialIndexes();
  console.log(`Rebuilt indexes for ${mongoose.modelNames().length} collections.`);

  if (rate) {
    await ExchangeRate.create({ ...rate, _id: 'singleton' });
    console.log(`Restored the exchange rate: 1 USD = ${rate.usdToSyp} SYP.`);
  }

  if (!(await supportsTransactions())) {
    console.warn(
      '\nWARNING: this MongoDB is a standalone, so financial writes will fail.\n' +
        'See backend/docs/LOCAL_SETUP.md for the single-node replica set setup.'
    );
  }

  console.log('\nClean. Next steps:');
  console.log('  npm run create-admin');
  console.log('  npm run seed-catalog');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
