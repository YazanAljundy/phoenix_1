/**
 * Scenario G - notifications.
 *
 * Two things had to be established before this could be written at all, and
 * both are findings in their own right:
 *
 *  1. There is no pharmacist-facing notification API. The Notification model
 *     is written on every order status change and every broadcast, and
 *     notification.model.js even indexes { userId, isRead } for a list the
 *     client would read - but no route exposes it, and the Flutter app's
 *     Endpoints class has no entry for one. So "read notifications" cannot be
 *     load-tested: it does not exist. Only the write path does.
 *
 *  2. The one notification endpoint is POST /api/admin/notifications, which
 *     broadcasts to every active pharmacy and warehouse user. It only calls
 *     FCM for users that have registered device tokens; this test refuses to
 *     run unless zero users have any, so no real device is ever pushed to.
 *     Actual FCM delivery therefore stays out of scope and needs a separate
 *     device/integration test - which is the correct scope for it anyway,
 *     since delivery is Firebase's to measure, not this backend's.
 *
 * What is measured here is the part Phoenix owns: the cost of the fan-out.
 * admin.service.js selects every recipient, then notification.service.js
 * sendToAll does `Promise.all(userIds.map(sendToUser))` with no concurrency
 * limit, and each sendToUser is a User.findById plus a Notification.create.
 * The interesting question is not how fast that is, but what it does to every
 * other request in flight while it runs - so a light, steady read load runs
 * throughout and its latency is compared before, during and after.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Monitor } = require('./lib/monitor');

const backendDir = path.resolve(__dirname, '..', 'backend');
const { MongoClient, ObjectId } = require(require.resolve('mongodb', { paths: [backendDir] }));
const bcrypt = require(require.resolve('bcrypt', { paths: [backendDir] }));

const RUNTIME = path.join(__dirname, '.runtime');
const fixtures = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'load-fixtures.json'), 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'tokens.json'), 'utf8'));
const API_BASE = process.env.BASE_URL || fixtures.baseUrl;
const RESULT_DIR = path.join(__dirname, 'results', 'notifications');
const MONGO_URI = process.env.LOAD_TEST_MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.LOAD_TEST_DB || 'phoenix';
const TAG = 'phoenix-load-test';
const ADMIN_PHONE = '0977990001';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ipSeq = 0;
const nextIp = () => { ipSeq += 1; return '10.230.' + ((ipSeq >> 8) & 255) + '.' + (ipSeq & 255); };

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (q) => Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1));
  return {
    count: sorted.length,
    medMs: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: Number(sorted[sorted.length - 1].toFixed(1)),
    avgMs: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1)),
  };
}

// A tagged admin fixture, created the same way as every other fixture account
// and removed by `seed-load-data.js --clean`. It exists because the only
// notification endpoint is admin-only; no existing admin's credentials are
// used or guessed.
async function ensureAdmin(db) {
  const existing = await db.collection('users').findOne({ phone: ADMIN_PHONE });
  if (existing) return;
  const now = new Date();
  await db.collection('users').insertOne({
    _id: new ObjectId(),
    name: '[LOADTEST] Notification Admin',
    phone: ADMIN_PHONE,
    password: await bcrypt.hash(fixtures.password, 10),
    role: 'admin',
    status: 'active',
    lang: 'ar',
    deviceTokens: [],
    loadTestTag: TAG,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  console.log('  created tagged admin fixture ' + ADMIN_PHONE);
}

async function assertNoDeviceTokens(db) {
  const count = await db.collection('users').countDocuments({ 'deviceTokens.0': { $exists: true } });
  if (count > 0) {
    throw new Error(
      count + ' user(s) have registered FCM device tokens. Broadcasting would send a real push ' +
      'to a real device, so this test refuses to run. Clear the tokens on a disposable database, ' +
      'or measure the notification fan-out on an environment with none.'
    );
  }
}

// Steady, cheap background traffic: GET /exchange-rate is a single findById,
// so any latency it develops is queueing behind something else rather than its
// own work - exactly the signal wanted here.
class BackgroundLoad {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.samples = [];
    this.running = false;
  }

  start(token) {
    this.running = true;
    this.workers = Array.from({ length: this.concurrency }, async () => {
      while (this.running) {
        const started = Date.now();
        try {
          const response = await fetch(API_BASE + '/exchange-rate', {
            headers: { Authorization: 'Bearer ' + token, 'X-Forwarded-For': nextIp() },
          });
          await response.arrayBuffer();
          this.samples.push({ t: started, ms: Date.now() - started, status: response.status });
        } catch (error) {
          this.samples.push({ t: started, ms: Date.now() - started, status: 0 });
        }
        await sleep(200);
      }
    });
  }

  async stop() {
    this.running = false;
    await Promise.all(this.workers);
  }

  window(from, to) {
    return stats(this.samples.filter((s) => s.t >= from && s.t <= to).map((s) => s.ms));
  }
}

async function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  console.log('Notification fan-out test');
  await assertNoDeviceTokens(db);
  console.log('  confirmed: no user has an FCM device token, so no push is sent');
  await ensureAdmin(db);

  const recipients = await db.collection('users')
    .countDocuments({ status: 'active', role: { $in: ['pharmacy', 'warehouse'] } });
  console.log('  broadcast will reach ' + recipients + ' active pharmacy/warehouse users');

  const loginResponse = await fetch(API_BASE + '/auth/login-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() },
    body: JSON.stringify({ phone: ADMIN_PHONE, password: fixtures.password }),
  });
  if (!loginResponse.ok) throw new Error('admin fixture login failed: HTTP ' + loginResponse.status);
  const adminToken = (await loginResponse.json()).token;

  const monitor = new Monitor(path.join(RESULT_DIR, 'monitor-broadcast.jsonl'));
  await monitor.start();
  try { await fetch('http://127.0.0.1:9999/reset', { signal: AbortSignal.timeout(2000) }); } catch (_) { /* probe optional */ }

  const background = new BackgroundLoad(4);
  background.start(tokens.pharmacyTokens[0].token);

  // Quiet baseline first, so "during" has something to be compared against.
  const baselineFrom = Date.now();
  await sleep(15000);
  const baselineTo = Date.now();

  const runs = [];
  for (let i = 0; i < Number(process.env.BROADCAST_RUNS || 3); i += 1) {
    const before = await db.collection('notifications').countDocuments();
    const startedAt = Date.now();
    const response = await fetch(API_BASE + '/admin/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + adminToken,
        'X-Forwarded-For': nextIp(),
      },
      body: JSON.stringify({
        titleAr: '[LOADTEST] broadcast',
        titleEn: '[LOADTEST] broadcast',
        bodyAr: '[LOADTEST] notification fan-out measurement',
        bodyEn: '[LOADTEST] notification fan-out measurement',
      }),
    });
    const ms = Date.now() - startedAt;
    const finishedAt = Date.now();
    const body = response.ok ? await response.json() : null;
    const after = await db.collection('notifications').countDocuments();

    const run = {
      status: response.status,
      requestMs: ms,
      reportedRecipients: body ? body.recipientCount : null,
      notificationsWritten: after - before,
      msPerRecipient: body && body.recipientCount
        ? Number((ms / body.recipientCount).toFixed(3)) : null,
      writesPerSecond: ms > 0 ? Number((((after - before) / ms) * 1000).toFixed(1)) : null,
      duringBackgroundLatency: background.window(startedAt, finishedAt),
    };
    runs.push(run);
    console.log('  run ' + (i + 1) + ': HTTP ' + run.status + ' in ' + run.requestMs + 'ms, ' +
      run.notificationsWritten + ' notifications written (' + run.writesPerSecond + '/s), ' +
      run.msPerRecipient + ' ms/recipient');
    if (run.duringBackgroundLatency) {
      console.log('           background GET /exchange-rate during: med=' +
        run.duringBackgroundLatency.medMs + 'ms max=' + run.duringBackgroundLatency.maxMs + 'ms');
    }
    await sleep(8000);
  }

  const recoveryFrom = Date.now();
  await sleep(12000);
  const recoveryTo = Date.now();

  await background.stop();
  const system = monitor.summarize(baselineFrom, Date.now());
  await monitor.stop();

  const baseline = background.window(baselineFrom, baselineTo);
  const recovery = background.window(recoveryFrom, recoveryTo);
  console.log('\n  background GET /exchange-rate:');
  console.log('    before broadcasts: med=' + baseline.medMs + 'ms p95=' + baseline.p95Ms + 'ms max=' + baseline.maxMs + 'ms');
  console.log('    after broadcasts:  med=' + recovery.medMs + 'ms p95=' + recovery.p95Ms + 'ms max=' + recovery.maxMs + 'ms');

  // The fixture notifications are removable by ownership: every recipient is a
  // tagged fixture user except the handful of pre-existing accounts, and those
  // are deleted here by matching the load-test title rather than by user.
  const cleanup = await db.collection('notifications')
    .deleteMany({ titleEn: '[LOADTEST] broadcast' });
  console.log('\n  removed ' + cleanup.deletedCount + ' notifications created by this test');

  const output = {
    generatedAt: new Date().toISOString(),
    recipients,
    fcmDeviceTokensPresent: 0,
    readApiExists: false,
    runs,
    backgroundLatency: { baseline, recovery },
    system,
    cleanupDeleted: cleanup.deletedCount,
  };
  fs.writeFileSync(path.join(RESULT_DIR, 'notification-results.json'), JSON.stringify(output, null, 2));
  console.log('Written to ' + path.join(RESULT_DIR, 'notification-results.json'));
  await client.close();
}

main().catch((error) => {
  console.error('notification-load FAILED: ' + error.message);
  process.exitCode = 1;
});
