// Load-test instrumentation ONLY. Loaded with `node -r` so the backend source
// is never touched. Exposes an out-of-band metrics endpoint on PROBE_PORT
// (default 9999) reporting event-loop lag, process CPU/memory, libuv handle
// counts and the mongoose/driver connection-pool state.
//
// Nothing here is required, imported, or referenced by application code.
const http = require('node:http');
const os = require('node:os');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

const PROBE_PORT = Number(process.env.PROBE_PORT || 9999);

// resolution 10ms: fine enough to see a blocked loop, cheap enough to leave on.
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

let lastCpu = process.cpuUsage();
let lastHr = process.hrtime.bigint();

// Counters fed by the driver's CMAP + command monitoring events, wired up
// lazily below once mongoose has actually connected.
const pool = {
  wired: false,
  created: 0,
  ready: 0,
  closed: 0,
  checkedOut: 0,
  checkedIn: 0,
  checkOutFailed: 0,
  pendingCheckouts: 0,
  maxPendingCheckouts: 0,
  maxPoolSize: null,
};

const commands = {
  started: 0,
  succeeded: 0,
  failed: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
  slowOver100ms: 0,
  slowOver500ms: 0,
  byCollection: Object.create(null),
};

function noteCommand(event, ok) {
  const ms = event.duration;
  commands.totalDurationMs += ms;
  if (ms > commands.maxDurationMs) commands.maxDurationMs = ms;
  if (ms > 100) commands.slowOver100ms += 1;
  if (ms > 500) commands.slowOver500ms += 1;
  if (ok) commands.succeeded += 1; else commands.failed += 1;
}

// mongoose is a module singleton: requiring it here yields the exact instance
// the application already loaded, so this observes the real connection.
function wirePool() {
  if (pool.wired) return;
  let mongoose;
  try {
    // The probe lives outside the backend's own node_modules tree, so plain
    // require('mongoose') would not resolve. Resolving against the backend
    // directory returns the very module instance the app already loaded
    // (module singleton), not a second copy.
    const backendDir = process.env.PROBE_APP_DIR || process.cwd();
    mongoose = require(require.resolve('mongoose', { paths: [backendDir] }));
  } catch (_) {
    return;
  }
  const conn = mongoose.connection;
  if (!conn || !conn.client) return;
  const client = conn.client;
  pool.wired = true;
  try {
    pool.maxPoolSize = client.options && client.options.maxPoolSize != null
      ? client.options.maxPoolSize
      : null;
  } catch (_) { /* option shape varies by driver version */ }

  client.on('connectionCreated', () => { pool.created += 1; });
  client.on('connectionReady', () => { pool.ready += 1; });
  client.on('connectionClosed', () => { pool.closed += 1; });
  client.on('connectionCheckOutStarted', () => {
    pool.pendingCheckouts += 1;
    if (pool.pendingCheckouts > pool.maxPendingCheckouts) {
      pool.maxPendingCheckouts = pool.pendingCheckouts;
    }
  });
  client.on('connectionCheckedOut', () => {
    pool.checkedOut += 1;
    if (pool.pendingCheckouts > 0) pool.pendingCheckouts -= 1;
  });
  client.on('connectionCheckOutFailed', () => {
    pool.checkOutFailed += 1;
    if (pool.pendingCheckouts > 0) pool.pendingCheckouts -= 1;
  });
  client.on('connectionCheckedIn', () => { pool.checkedIn += 1; });

  // Command monitoring is only emitted when the client was constructed with
  // monitorCommands: true. The app does not set it, so these listeners stay
  // silent unless the probe's own MONITOR_COMMANDS path enabled it.
  client.on('commandStarted', () => { commands.started += 1; });
  client.on('commandSucceeded', (e) => noteCommand(e, true));
  client.on('commandFailed', (e) => noteCommand(e, false));
}

const wireTimer = setInterval(wirePool, 500);
wireTimer.unref();

function snapshot() {
  const nowHr = process.hrtime.bigint();
  const cpu = process.cpuUsage();
  const wallMicros = Number(nowHr - lastHr) / 1000;
  const usedMicros = (cpu.user - lastCpu.user) + (cpu.system - lastCpu.system);
  lastCpu = cpu;
  lastHr = nowHr;
  // Share of ONE core. >100 means the process is using more than a full core
  // (worker threads / libuv pool), which on a single-threaded Express app is
  // mostly GC and TLS work.
  const cpuPercentOfOneCore = wallMicros > 0 ? (usedMicros / wallMicros) * 100 : 0;

  const mem = process.memoryUsage();
  const ns = 1e6; // ns -> ms

  const out = {
    ts: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    eventLoop: {
      meanMs: loopDelay.mean / ns,
      minMs: loopDelay.min / ns,
      maxMs: loopDelay.max / ns,
      p50Ms: loopDelay.percentile(50) / ns,
      p90Ms: loopDelay.percentile(90) / ns,
      p99Ms: loopDelay.percentile(99) / ns,
    },
    cpu: {
      percentOfOneCore: Number(cpuPercentOfOneCore.toFixed(2)),
      percentOfMachine: Number((cpuPercentOfOneCore / os.cpus().length).toFixed(2)),
      cores: os.cpus().length,
    },
    memory: {
      rssMb: Number((mem.rss / 1048576).toFixed(2)),
      heapUsedMb: Number((mem.heapUsed / 1048576).toFixed(2)),
      heapTotalMb: Number((mem.heapTotal / 1048576).toFixed(2)),
      externalMb: Number((mem.external / 1048576).toFixed(2)),
      arrayBuffersMb: Number((mem.arrayBuffers / 1048576).toFixed(2)),
    },
    handles: {
      // Private but stable across Node 18-24, and the only way to see socket
      // accumulation without an APM agent.
      activeHandles: typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : null,
      activeRequests: typeof process._getActiveRequests === 'function' ? process._getActiveRequests().length : null,
    },
    mongoPool: { ...pool },
    mongoCommands: {
      ...commands,
      avgDurationMs: commands.succeeded + commands.failed > 0
        ? Number((commands.totalDurationMs / (commands.succeeded + commands.failed)).toFixed(2))
        : 0,
      byCollection: undefined,
    },
    perfNow: performance.now(),
  };
  return out;
}

// ---------------------------------------------------------------------------
// On-demand V8 CPU profile
// ---------------------------------------------------------------------------
//
// GET /profile?ms=10000 samples the running backend and returns the raw
// .cpuprofile. This is what turns "the backend is CPU-bound" into a named
// function, which is the difference between guessing at a bottleneck and
// attributing it. The profiler is only ever attached for the duration of the
// request; nothing runs while it is idle.
const inspector = require('node:inspector');
let profiling = false;

function runProfile(durationMs) {
  return new Promise((resolve, reject) => {
    if (profiling) return reject(new Error('a profile is already running'));
    profiling = true;
    const session = new inspector.Session();
    try {
      session.connect();
    } catch (err) {
      profiling = false;
      return reject(err);
    }
    session.post('Profiler.enable', () => {
      // 100us sampling: fine enough to separate Mongoose hydration from JSON
      // serialisation without measurably perturbing the thing being measured.
      session.post('Profiler.setSamplingInterval', { interval: 100 }, () => {
        session.post('Profiler.start', () => {
          setTimeout(() => {
            session.post('Profiler.stop', (err, result) => {
              session.disconnect();
              profiling = false;
              if (err) return reject(err);
              resolve(result.profile);
            });
          }, durationMs);
        });
      });
    });
  });
}

// Collapses a .cpuprofile into self-time per function, which is the view that
// actually answers "where is the CPU going".
function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfSamples = new Map();
  for (const id of profile.samples) {
    selfSamples.set(id, (selfSamples.get(id) || 0) + 1);
  }
  const total = profile.samples.length || 1;
  const rows = [];
  for (const [id, count] of selfSamples) {
    const node = byId.get(id);
    if (!node) continue;
    const frame = node.callFrame;
    const url = (frame.url || '').replace(/^file:\/\/\//, '');
    rows.push({
      fn: frame.functionName || '(anonymous)',
      url: url.replace(/^.*[\\/]node_modules[\\/]/, 'node_modules/').replace(/^.*[\\/]backend[\\/]/, 'backend/'),
      line: frame.lineNumber + 1,
      selfPercent: Number(((count / total) * 100).toFixed(2)),
      samples: count,
    });
  }
  rows.sort((a, b) => b.samples - a.samples);

  // Same figures rolled up by source file, so a cost spread across many small
  // functions in one library still shows as that library's cost.
  const byFile = new Map();
  for (const row of rows) {
    const key = row.url || '(native)';
    byFile.set(key, (byFile.get(key) || 0) + row.samples);
  }
  const files = [...byFile.entries()]
    .map(([url, samples]) => ({ url, selfPercent: Number(((samples / total) * 100).toFixed(2)), samples }))
    .sort((a, b) => b.samples - a.samples);

  return { totalSamples: total, topFunctions: rows.slice(0, 40), topFiles: files.slice(0, 25) };
}

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/profile')) {
    const ms = Math.min(60000, Number(new URL(req.url, 'http://x').searchParams.get('ms') || 10000));
    runProfile(ms).then((profile) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary: summarizeProfile(profile), profile }));
    }).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }
  if (req.url === '/reset') {
    loopDelay.reset();
    commands.started = 0; commands.succeeded = 0; commands.failed = 0;
    commands.totalDurationMs = 0; commands.maxDurationMs = 0;
    commands.slowOver100ms = 0; commands.slowOver500ms = 0;
    pool.checkOutFailed = 0; pool.maxPendingCheckouts = pool.pendingCheckouts;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"reset":true}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(snapshot()));
});

server.listen(PROBE_PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[probe] load-test instrumentation on http://127.0.0.1:${PROBE_PORT}`);
});
server.unref();
