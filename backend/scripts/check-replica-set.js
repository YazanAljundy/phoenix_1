#!/usr/bin/env node
// Reports whether the configured MongoDB can run transactions, and can
// initiate a single-node replica set on request.
//
//   node backend/scripts/check-replica-set.js            # report only
//   node backend/scripts/check-replica-set.js --initiate # run rs.initiate() if needed
//
// See backend/docs/LOCAL_SETUP.md.
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/phoenix';
const shouldInitiate = process.argv.includes('--initiate');

async function main() {
  // directConnection: an un-initiated member is not discoverable through the
  // normal topology scan, so without this the driver just times out instead of
  // letting us run rs.initiate() on it.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, directConnection: true });
  const admin = mongoose.connection.db.admin();

  let info = await admin.command({ hello: 1 });

  if (info.setName) {
    console.log(`replica set: ${info.setName}  (transactions supported)`);
    console.log(`primary: ${info.primary ?? '(electing)'}`);
    return;
  }

  // `isreplicaset: true` means mongod was started with --replSet but the set
  // has never been initiated - that is the one case we can fix from here.
  if (info.isreplicaset) {
    if (!shouldInitiate) {
      console.log('mongod has --replSet configured but the set is NOT initiated.');
      console.log('Re-run with --initiate.');
      process.exitCode = 1;
      return;
    }
    console.log('initiating single-node replica set...');
    await admin.command({ replSetInitiate: {} });

    // The election takes a moment; poll rather than guessing a sleep.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      info = await admin.command({ hello: 1 });
      if (info.setName && info.isWritablePrimary) {
        console.log(`replica set ${info.setName} is up (transactions supported).`);
        return;
      }
    }
    console.error('the set was initiated but no primary was elected in 10s.');
    process.exitCode = 1;
    return;
  }

  console.error('This mongod is a STANDALONE - transactions are not available.');
  console.error('See backend/docs/LOCAL_SETUP.md to enable a single-node replica set.');
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
