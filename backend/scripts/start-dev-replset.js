#!/usr/bin/env node
// Option B from backend/docs/LOCAL_SETUP.md: a second, unprivileged mongod on
// port 27018 with --replSet, for developers who cannot (or would rather not)
// reconfigure the installed MongoDB service.
//
//   node backend/scripts/start-dev-replset.js
//   MONGODB_URI=mongodb://127.0.0.1:27018/phoenix
//
// Leave it running in its own terminal; Ctrl-C stops it.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.DEV_REPLSET_PORT) || 27018;
const REPL_SET = 'rs0';
const dbPath = process.env.DEV_REPLSET_DBPATH || path.join(os.homedir(), '.phoenix-mongo-rs', String(PORT));

// mongod.exe lives under Program Files but only needs to be *executed*, not
// written to - so this needs no elevation.
function findMongod() {
  if (process.env.MONGOD_PATH) return process.env.MONGOD_PATH;
  if (process.platform !== 'win32') return 'mongod';

  const root = 'C:\\Program Files\\MongoDB\\Server';
  if (!fs.existsSync(root)) return 'mongod';
  const versions = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const version of versions) {
    const candidate = path.join(root, version, 'bin', 'mongod.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'mongod';
}

async function waitForPrimary() {
  const mongoose = require('mongoose');
  const uri = `mongodb://127.0.0.1:${PORT}/admin`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      // directConnection: an un-initiated replica set member is not
      // discoverable by the normal topology scan.
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 1000, directConnection: true });
      const admin = mongoose.connection.db.admin();
      let info = await admin.command({ hello: 1 });

      if (!info.setName) {
        console.log('initiating replica set...');
        await admin.command({ replSetInitiate: {} });
      }
      for (let poll = 0; poll < 20; poll += 1) {
        info = await admin.command({ hello: 1 });
        if (info.setName && info.isWritablePrimary) {
          console.log('');
          console.log(`  replica set ${info.setName} ready on port ${PORT}`);
          console.log(`  MONGODB_URI=mongodb://127.0.0.1:${PORT}/phoenix`);
          console.log('');
          await mongoose.disconnect();
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await mongoose.disconnect();
    } catch {
      try {
        await mongoose.disconnect();
      } catch {
        /* not connected */
      }
    }
  }
  return false;
}

fs.mkdirSync(dbPath, { recursive: true });
const mongod = findMongod();
console.log(`mongod:  ${mongod}`);
console.log(`dbPath:  ${dbPath}`);
console.log(`port:    ${PORT}  replSet: ${REPL_SET}`);

const child = spawn(mongod, ['--replSet', REPL_SET, '--port', String(PORT), '--dbpath', dbPath, '--bind_ip', '127.0.0.1'], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

child.on('error', (err) => {
  console.error(`failed to start mongod: ${err.message}`);
  console.error('Set MONGOD_PATH to the mongod executable if it is not on PATH.');
  process.exit(1);
});

waitForPrimary().then((ok) => {
  if (!ok) {
    console.error('mongod started but no primary was elected. Check the log above.');
  }
});

const shutdown = () => {
  child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
