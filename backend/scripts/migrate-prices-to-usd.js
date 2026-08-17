// One-time migration: the catalog switched from SYP-denominated prices to
// USD-denominated prices as the source of truth (Section: USD-first catalog
// pricing - order.service.js now derives SYP live from the exchange rate at
// order time instead). Every Product.price (and priceHistory entry) already
// in the database is still the old SYP figure and needs converting once,
// in place, using today's exchange rate - see exchangeRate.service.js for
// where that rate comes from.
//
// Requires a rate to already exist (set one via the admin panel, or run the
// backend once so the API cron populates it) - refuses to guess.
//
// Usage: npm run migrate-prices-to-usd
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Product = require('../src/models/product.model');
const ExchangeRate = require('../src/models/exchangeRate.model');

async function main() {
  await mongoose.connect(env.mongodbUri);

  const rate = await ExchangeRate.findById('singleton');
  if (!rate) {
    console.error('No exchange rate is set yet - set one from the admin panel first, then re-run this script.');
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  const usdToSyp = rate.usdToSyp;
  console.log(`Converting existing SYP prices to USD at 1 USD = ${usdToSyp} SYP.`);

  const products = await Product.find({});
  let updated = 0;

  for (const product of products) {
    product.price = Math.round((product.price / usdToSyp) * 100) / 100;
    for (const entry of product.priceHistory) {
      entry.oldPrice = Math.round((entry.oldPrice / usdToSyp) * 100) / 100;
      entry.newPrice = Math.round((entry.newPrice / usdToSyp) * 100) / 100;
    }
    await product.save();
    updated += 1;
  }

  console.log(`Converted ${updated} product(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
