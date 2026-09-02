/**
 * Socket.IO load driver (Phase 2 scenario H, measured separately from HTTP).
 *
 * k6 has no Socket.IO client - only raw WebSockets - and hand-rolling the
 * Engine.IO handshake would test my protocol transcription rather than the
 * server. This uses the same socket.io-client the project already depends on,
 * driven from Node.
 *
 * Three independent measurements, because "Socket.IO capacity" is three
 * different numbers:
 *   connect  - how many concurrent authenticated connections the server holds,
 *              and what the handshake costs (jwt.verify + User.findById +
 *              Warehouse.findOne per connection, in realtime/index.js).
 *   events   - fan-out latency and throughput to a room, triggered through the
 *              real path: POST /orders makes order.service.js emit
 *              order.created to that order's warehouse room.
 *   reconnect- what happens when a large set of connections drops at once.
 *
 * Only warehouse-role fixture accounts are used. The handshake refuses role
 * 'pharmacy' outright (resolveRoomsFor returns no rooms -> NO_SUBSCRIPTIONS),
 * so the Flutter app population cannot appear here at all - that is a property
 * of the system, not a limitation of this driver, and it is reported as such.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Monitor } = require('./lib/monitor');

const backendDir = path.resolve(__dirname, '..', 'backend');
const { io } = require(require.resolve('socket.io-client', { paths: [backendDir] }));

const RUNTIME = path.join(__dirname, '.runtime');
const fixtures = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'load-fixtures.json'), 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'tokens.json'), 'utf8'));

const API_BASE = process.env.BASE_URL || fixtures.baseUrl;
const SOCKET_URL = API_BASE.replace(/\/api\/?$/, '');
const RESULT_DIR = path.join(__dirname, 'results', process.env.SOCKET_TAG || 'socket');

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return Number(sorted[index].toFixed(1));
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    count: sorted.length,
    minMs: Number(sorted[0].toFixed(1)),
    medMs: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: Number(sorted[sorted.length - 1].toFixed(1)),
    avgMs: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1)),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Connection pool
// ---------------------------------------------------------------------------

class SocketPool {
  constructor(accountTokens) {
    this.accountTokens = accountTokens;
    this.sockets = [];
    this.connectLatencies = [];
    this.failures = [];
    this.disconnects = [];
    this.reconnects = [];
  }

  // Connections are opened in waves rather than all at once: the handshake is
  // two database round-trips deep, so an instantaneous burst measures the
  // burst, not the ceiling.
  async open(count, { batchSize = 50, batchDelayMs = 200, timeoutMs = 20000 } = {}) {
    for (let start = 0; start < count; start += batchSize) {
      const size = Math.min(batchSize, count - start);
      const batch = [];
      for (let i = 0; i < size; i += 1) {
        const index = start + i;
        batch.push(this.connectOne(index, timeoutMs));
      }
      await Promise.all(batch);
      if (start + size < count) await sleep(batchDelayMs);
    }
    return this;
  }

  connectOne(index, timeoutMs) {
    return new Promise((resolve) => {
      const account = this.accountTokens[index % this.accountTokens.length];
      const started = Date.now();
      let settled = false;
      const socket = io(SOCKET_URL, {
        auth: { token: account.token },
        transports: ['websocket'],
        reconnection: false,
        timeout: timeoutMs,
        forceNew: true,
      });
      const done = (ok, reason) => {
        if (settled) return;
        settled = true;
        if (ok) {
          this.connectLatencies.push(Date.now() - started);
          this.sockets.push(socket);
        } else {
          this.failures.push({ index, reason, ms: Date.now() - started });
          socket.close();
        }
        resolve();
      };
      socket.on('connect', () => done(true));
      socket.on('connect_error', (err) => done(false, err.message));
      socket.on('disconnect', (reason) => {
        this.disconnects.push({ index, reason, at: Date.now() });
      });
      setTimeout(() => done(false, 'client-side timeout'), timeoutMs + 1000);
    });
  }

  get connected() {
    return this.sockets.filter((s) => s.connected).length;
  }

  closeAll() {
    for (const socket of this.sockets) socket.close();
    this.sockets = [];
  }
}

// ---------------------------------------------------------------------------
// S1 - concurrent connection capacity
// ---------------------------------------------------------------------------

async function connectionCapacity(levels) {
  const accounts = tokens.warehouseTokens;
  const results = [];

  for (const target of levels) {
    console.log('\n=== SOCKETS ' + target + ' concurrent ===');
    const monitor = new Monitor(path.join(RESULT_DIR, 'monitor-connect-' + target + '.jsonl'));
    await monitor.start();
    try { await fetch('http://127.0.0.1:9999/reset', { signal: AbortSignal.timeout(2000) }); } catch (_) { /* probe optional */ }

    const pool = new SocketPool(accounts);
    const started = Date.now();
    await pool.open(target, { batchSize: Number(arg('batch', '50')), batchDelayMs: 200 });
    const openedAt = Date.now();

    // Hold, so memory and handle counts are measured on a settled population
    // rather than mid-handshake.
    const holdMs = Number(arg('hold-ms', '30000'));
    await sleep(holdMs);

    const system = monitor.summarize(openedAt, Date.now());
    await monitor.stop();

    const connected = pool.connected;
    const record = {
      targetConnections: target,
      established: pool.connectLatencies.length,
      stillConnectedAfterHold: connected,
      failed: pool.failures.length,
      successRate: Number((pool.connectLatencies.length / target).toFixed(4)),
      droppedDuringHold: pool.disconnects.length,
      openDurationSec: Number(((openedAt - started) / 1000).toFixed(1)),
      connectionsPerSec: Number((pool.connectLatencies.length / ((openedAt - started) / 1000)).toFixed(1)),
      connectLatency: stats(pool.connectLatencies),
      failureReasons: pool.failures.reduce((acc, f) => {
        acc[f.reason] = (acc[f.reason] || 0) + 1;
        return acc;
      }, {}),
      disconnectReasons: pool.disconnects.reduce((acc, d) => {
        acc[d.reason] = (acc[d.reason] || 0) + 1;
        return acc;
      }, {}),
      system,
    };
    results.push(record);

    console.log('  established ' + record.established + '/' + target +
      ' (' + (record.successRate * 100).toFixed(1) + '%)' +
      '  rate=' + record.connectionsPerSec + '/s' +
      '  connect p95=' + (record.connectLatency ? record.connectLatency.p95Ms : 'n/a') + 'ms' +
      '  dropped=' + record.droppedDuringHold);
    if (system) {
      console.log('  backend rss=' + system.backend.rssMaxMb + 'MB' +
        ' handles=' + system.backend.activeHandlesMax +
        ' loopLag(mean)=' + (system.backend.eventLoopMeanMsAvg || 0).toFixed(1) + 'ms' +
        ' cpu=' + system.backend.cpuAvgPercentOfOneCore + '% of 1 core');
    }
    if (Object.keys(record.failureReasons).length) {
      console.log('  failures: ' + JSON.stringify(record.failureReasons));
    }

    pool.closeAll();
    await sleep(5000);

    if (record.successRate < 0.9) {
      console.log('  <90% of connections established - stopping escalation.');
      break;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// S2 - event fan-out latency and throughput
// ---------------------------------------------------------------------------
//
// Every listener authenticates as the warehouse that owns the order-target
// catalog, so all of them land in the same room and each POST /orders fans out
// to all of them. Latency is measured from the moment the HTTP request is sent
// to the moment each socket receives order.created - the emit happens inside
// createOrder before the HTTP response is written, so this is the real
// end-to-end signal path a dashboard would see.

async function eventFanout(listenerCount, eventCount, intervalMs) {
  console.log('\n=== EVENT FAN-OUT: ' + listenerCount + ' listeners in one room, ' +
    eventCount + ' events at ' + intervalMs + 'ms intervals ===');

  const ownerPhone = fixtures.catalogWarehouses[0].phone;
  const owner = tokens.warehouseTokens.find((t) => t.phone === ownerPhone)
    || tokens.pharmacyTokens.find((t) => t.phone === ownerPhone);
  if (!owner) {
    // The catalog warehouses' own accounts are not in warehouseTokens (which
    // holds the socket-only fixtures), so mint one here rather than guessing.
    const response = await fetch(API_BASE + '/auth/login-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.200.0.1' },
      body: JSON.stringify({ phone: ownerPhone, password: fixtures.password }),
    });
    if (!response.ok) throw new Error('could not authenticate the order-target warehouse owner');
    const body = await response.json();
    tokens.warehouseTokens.push({ phone: ownerPhone, token: body.token });
  }
  const ownerToken = (tokens.warehouseTokens.find((t) => t.phone === ownerPhone)).token;

  const monitor = new Monitor(path.join(RESULT_DIR, 'monitor-events-' + listenerCount + '.jsonl'));
  await monitor.start();

  const pool = new SocketPool([{ phone: ownerPhone, token: ownerToken }]);
  await pool.open(listenerCount, { batchSize: 50, batchDelayMs: 150 });
  console.log('  listeners connected: ' + pool.connected + '/' + listenerCount);

  // Arrival buckets are created by the listener, not by the writer.
  // order.service.js calls emitToWarehouse *before* res.json(), so the socket
  // event reliably lands before the HTTP response has even been parsed here -
  // pre-registering the id from the response would lose that race every single
  // time and score a perfectly working fan-out as zero deliveries.
  const arrivals = new Map(); // orderId -> [arrival timestamps]
  let totalEvents = 0;
  for (const socket of pool.sockets) {
    socket.on('order.created', (payload) => {
      totalEvents += 1;
      const bucket = arrivals.get(payload.orderId);
      if (bucket) bucket.push(Date.now());
      else arrivals.set(payload.orderId, [Date.now()]);
    });
  }

  // One pharmacy account drives the writes.
  const buyer = tokens.pharmacyTokens[0];
  const emitStarted = Date.now();
  const httpLatencies = [];
  const firedAt = new Map();

  for (let i = 0; i < eventCount; i += 1) {
    const sentAt = Date.now();
    const response = await fetch(API_BASE + '/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + buyer.token,
        'X-Forwarded-For': '10.201.' + ((i >> 8) & 255) + '.' + (i & 255),
      },
      body: JSON.stringify({
        warehouseId: fixtures.orderTargetWarehouseId,
        items: [{ productId: fixtures.orderTargetProductIds[i % fixtures.orderTargetProductIds.length], quantity: 1 }],
        notes: '[LOADTEST] socket fan-out',
      }),
    });
    httpLatencies.push(Date.now() - sentAt);
    if (response.ok) {
      const body = await response.json();
      const orderId = body.order && (body.order.id || body.order._id);
      if (orderId) firedAt.set(String(orderId), sentAt);
    }
    if (intervalMs > 0) await sleep(intervalMs);
  }

  // Drain: allow in-flight fan-out to land before measuring.
  await sleep(5000);
  const emitWindowSec = (Date.now() - emitStarted) / 1000;

  const latencies = [];
  let delivered = 0;
  let unmatched = 0;
  for (const [orderId, timestamps] of arrivals) {
    const sentAt = firedAt.get(orderId);
    delivered += timestamps.length;
    if (sentAt === undefined) {
      // An event for an order this run did not create (a leftover in flight
      // from a previous level). Counted, but not timed against a start it has
      // no record of.
      unmatched += timestamps.length;
      continue;
    }
    for (const at of timestamps) latencies.push(at - sentAt);
  }
  // Read before closeAll(): closing empties the pool, so asking it afterwards
  // reports zero listeners for a run that had hundreds.
  const connectedDuringRun = pool.connected;
  const expected = firedAt.size * connectedDuringRun;

  const system = monitor.summarize(emitStarted, Date.now());
  await monitor.stop();
  pool.closeAll();

  const record = {
    listeners: listenerCount,
    listenersConnected: connectedDuringRun,
    ordersCreated: firedAt.size,
    unmatchedDeliveries: unmatched,
    expectedDeliveries: expected,
    actualDeliveries: delivered,
    deliveryRate: expected ? Number((delivered / expected).toFixed(4)) : null,
    eventsPerSecond: Number((totalEvents / emitWindowSec).toFixed(1)),
    fanoutLatency: stats(latencies),
    orderHttpLatency: stats(httpLatencies),
    system,
  };
  console.log('  orders=' + record.ordersCreated +
    ' deliveries=' + record.actualDeliveries + '/' + record.expectedDeliveries +
    ' (' + ((record.deliveryRate || 0) * 100).toFixed(2) + '%)' +
    ' events/s=' + record.eventsPerSecond +
    ' fanout p95=' + (record.fanoutLatency ? record.fanoutLatency.p95Ms : 'n/a') + 'ms');
  return record;
}

// ---------------------------------------------------------------------------
// S3 - mass reconnection
// ---------------------------------------------------------------------------

async function reconnectStorm(count) {
  console.log('\n=== RECONNECTION STORM: ' + count + ' connections dropped and re-established ===');
  const monitor = new Monitor(path.join(RESULT_DIR, 'monitor-reconnect-' + count + '.jsonl'));
  await monitor.start();

  const pool = new SocketPool(tokens.warehouseTokens);
  await pool.open(count, { batchSize: 50, batchDelayMs: 150 });
  const initial = pool.connected;
  await sleep(3000);

  // Drop everything at once, the way a backend restart or a network blip looks
  // to a room full of dashboards, then reconnect with no stagger at all.
  pool.closeAll();
  const dropAt = Date.now();
  await sleep(1000);

  const second = new SocketPool(tokens.warehouseTokens);
  const reconnectStart = Date.now();
  await second.open(count, { batchSize: count, batchDelayMs: 0, timeoutMs: 30000 });
  const reconnectMs = Date.now() - reconnectStart;

  await sleep(5000);
  const system = monitor.summarize(dropAt, Date.now());
  await monitor.stop();

  const record = {
    connections: count,
    initiallyEstablished: initial,
    reestablished: second.connectLatencies.length,
    reestablishFailed: second.failures.length,
    reestablishSuccessRate: Number((second.connectLatencies.length / count).toFixed(4)),
    reestablishWallMs: reconnectMs,
    reestablishLatency: stats(second.connectLatencies),
    failureReasons: second.failures.reduce((acc, f) => {
      acc[f.reason] = (acc[f.reason] || 0) + 1;
      return acc;
    }, {}),
    system,
  };
  second.closeAll();
  console.log('  re-established ' + record.reestablished + '/' + count +
    ' in ' + record.reestablishWallMs + 'ms' +
    '  p95=' + (record.reestablishLatency ? record.reestablishLatency.p95Ms : 'n/a') + 'ms');
  if (Object.keys(record.failureReasons).length) {
    console.log('  failures: ' + JSON.stringify(record.failureReasons));
  }
  return record;
}

// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const only = arg('only', 'all');
  const output = { generatedAt: new Date().toISOString(), socketUrl: SOCKET_URL };

  if (only === 'all' || only === 'connect') {
    const levels = arg('levels', '50,100,250,500,1000,2000,3000')
      .split(',').map((v) => Number(v.trim())).filter(Boolean);
    output.connectionCapacity = await connectionCapacity(levels);
  }
  if (only === 'all' || only === 'events') {
    output.eventFanout = [];
    for (const listeners of arg('listeners', '10,100,500').split(',').map(Number)) {
      output.eventFanout.push(
        await eventFanout(listeners, Number(arg('events', '30')), Number(arg('interval', '200')))
      );
      await sleep(3000);
    }
  }
  if (only === 'all' || only === 'reconnect') {
    output.reconnect = await reconnectStorm(Number(arg('reconnect-count', '500')));
  }

  fs.writeFileSync(path.join(RESULT_DIR, 'socket-results.json'), JSON.stringify(output, null, 2));
  console.log('\nSocket results written to ' + path.join(RESULT_DIR, 'socket-results.json'));
}

main().catch((error) => {
  console.error('socket-load FAILED: ' + error.message);
  console.error(error.stack);
  process.exitCode = 1;
});
