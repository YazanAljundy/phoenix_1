/**
 * Renders the markdown tables for LOAD_TEST_REPORT.md straight from the result
 * JSON, so every number in the report is traceable to a file on disk and none
 * of them are typed by hand.
 *
 *   node build-report-data.js > results/report-tables.md
 */
const fs = require('node:fs');
const path = require('node:path');

const RESULTS = path.join(__dirname, 'results');

function readJson(...segments) {
  const file = path.join(RESULTS, ...segments);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function num(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return Number(value).toFixed(digits);
}

function levelTable(index, title) {
  if (!index || !index.levels) return '_' + title + ': no results_\n';
  const rows = index.levels.filter((l) => !l.aborted);
  const lines = [
    '| VUs | RPS | avg | med | p90 | p95 | p99 | max | Err % | 4xx | 5xx | 429 | t/o | Status |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |',
  ];
  for (const level of rows) {
    lines.push('| ' + [
      level.vus,
      num(level.rps, 1),
      num(level.avgMs) + ' ms',
      num(level.medMs) + ' ms',
      num(level.p90Ms) + ' ms',
      num(level.p95Ms) + ' ms',
      num(level.p99Ms) + ' ms',
      num(level.maxMs) + ' ms',
      num(level.errorRate * 100, 2),
      level.http4xx,
      level.http5xx,
      level.http429,
      level.timeouts,
      level.status,
    ].join(' | ') + ' |');
  }
  const aborted = index.levels.filter((l) => l.aborted);
  for (const level of aborted) {
    lines.push('| ' + level.vus + ' | — | — | — | — | — | — | — | — | — | — | — | — | ABORTED (' + level.reason + ') |');
  }
  return lines.join('\n') + '\n';
}

function systemTable(index) {
  if (!index || !index.levels) return '';
  const lines = [
    '| VUs | Machine CPU avg | Backend CPU (of 1 core) | Event-loop mean | Event-loop max | Backend RSS | Mongo conns | Mongo queries/s | k6 CPU (of machine) |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const level of index.levels) {
    if (!level.system) continue;
    const s = level.system;
    const qps = s.mongo.queriesInWindow && s.mongo.windowSeconds
      ? (s.mongo.queriesInWindow / s.mongo.windowSeconds) : null;
    lines.push('| ' + [
      level.vus,
      num(s.machineCpuAvgPercent, 1) + ' %',
      num(s.backend.cpuAvgPercentOfOneCore, 1) + ' %',
      num(s.backend.eventLoopMeanMsAvg, 1) + ' ms',
      num(s.backend.eventLoopMaxMs, 0) + ' ms',
      num(s.backend.rssMaxMb, 0) + ' MB',
      s.mongo.connectionsMax,
      num(qps, 0),
      num(s.processes.k6CpuAvgPercentOfMachine, 1) + ' %',
    ].join(' | ') + ' |');
  }
  return lines.join('\n') + '\n';
}

function endpointTable(level) {
  if (!level || !level.endpoints) return '';
  const lines = [
    '| Endpoint | Requests | RPS | med | p95 | p99 | max | Err % |',
    '| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of level.endpoints) {
    lines.push('| `' + row.endpoint + '` | ' + [
      row.requests,
      num(row.rps, 2),
      num(row.medMs) + ' ms',
      num(row.p95Ms) + ' ms',
      num(row.p99Ms) + ' ms',
      num(row.maxMs) + ' ms',
      num(row.errorRate * 100, 2),
    ].join(' | ') + ' |');
  }
  return lines.join('\n') + '\n';
}

function socketTables(socket) {
  if (!socket) return '_No socket results._\n';
  const out = [];
  if (socket.connectionCapacity) {
    out.push('**Concurrent connections**\n');
    out.push('| Target | Established | Success % | Connects/s | connect med | connect p95 | connect max | Dropped | Backend RSS | Event-loop mean |');
    out.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of socket.connectionCapacity) {
      const s = row.system;
      out.push('| ' + [
        row.targetConnections,
        row.established,
        num(row.successRate * 100, 1),
        num(row.connectionsPerSec, 1),
        row.connectLatency ? num(row.connectLatency.medMs) + ' ms' : 'n/a',
        row.connectLatency ? num(row.connectLatency.p95Ms) + ' ms' : 'n/a',
        row.connectLatency ? num(row.connectLatency.maxMs) + ' ms' : 'n/a',
        row.droppedDuringHold,
        s ? num(s.backend.rssMaxMb) + ' MB' : 'n/a',
        s ? num(s.backend.eventLoopMeanMsAvg, 1) + ' ms' : 'n/a',
      ].join(' | ') + ' |');
    }
    out.push('');
  }
  if (socket.eventFanout) {
    out.push('**Event fan-out (`order.created` into one warehouse room)**\n');
    out.push('| Listeners | Orders fired | Deliveries | Delivery % | Events/s | fanout med | fanout p95 | fanout max |');
    out.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of socket.eventFanout) {
      out.push('| ' + [
        row.listenersConnected,
        row.ordersCreated,
        row.actualDeliveries + ' / ' + row.expectedDeliveries,
        num((row.deliveryRate || 0) * 100, 2),
        num(row.eventsPerSecond, 1),
        row.fanoutLatency ? num(row.fanoutLatency.medMs) + ' ms' : 'n/a',
        row.fanoutLatency ? num(row.fanoutLatency.p95Ms) + ' ms' : 'n/a',
        row.fanoutLatency ? num(row.fanoutLatency.maxMs) + ' ms' : 'n/a',
      ].join(' | ') + ' |');
    }
    out.push('');
  }
  if (socket.reconnect) {
    const r = socket.reconnect;
    out.push('**Reconnection storm**\n');
    out.push('| Connections | Re-established | Success % | Wall time | p95 |');
    out.push('| ---: | ---: | ---: | ---: | ---: |');
    out.push('| ' + [
      r.connections, r.reestablished, num(r.reestablishSuccessRate * 100, 1),
      r.reestablishWallMs + ' ms',
      r.reestablishLatency ? num(r.reestablishLatency.p95Ms) + ' ms' : 'n/a',
    ].join(' | ') + ' |');
    out.push('');
  }
  return out.join('\n');
}

function scalingTable(scaling) {
  if (!scaling) return '_No scaling results._\n';
  const sizes = scaling.catalogSizes;
  const lines = [
    '| Endpoint | ' + sizes.map((s) => s + ' products').join(' | ') + ' | Growth | Response size at ' + sizes[sizes.length - 1] + ' |',
    '| :--- | ' + sizes.map(() => '---:').join(' | ') + ' | ---: | ---: |',
  ];
  for (const row of scaling.results) {
    const cells = sizes.map((s) => num(row.bySize[s].medMs) + ' ms');
    const biggest = row.bySize[sizes[sizes.length - 1]];
    lines.push('| `' + row.endpoint + '` | ' + cells.join(' | ') +
      ' | x' + row.growthFactor + ' | ' + Math.round(biggest.responseBytes / 1024) + ' KB |');
  }
  return lines.join('\n') + '\n';
}

function uploadTable(upload) {
  if (!upload) return '_No upload results._\n';
  const lines = [
    '| Concurrency | Uploads | Uploads/s | med | p95 | max | Failed |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of upload.levels) {
    lines.push('| ' + [
      row.concurrency, row.succeeded, num(row.uploadsPerSecond, 2),
      row.latency ? num(row.latency.medMs) + ' ms' : 'n/a',
      row.latency ? num(row.latency.p95Ms) + ' ms' : 'n/a',
      row.latency ? num(row.latency.maxMs) + ' ms' : 'n/a',
      row.failed,
    ].join(' | ') + ' |');
  }
  return lines.join('\n') + '\n';
}

// A capacity curve is assembled from more than one run: the sweep finds the
// knee and stops, the bisection fills in the levels between the last PASS and
// the first FAIL, and the soak re-measures one level over five minutes. Merging
// them by VU count (later runs winning) produces one curve per configuration.
function mergeRuns(tags) {
  const byVus = new Map();
  let meta = null;
  for (const tag of tags) {
    const index = readJson(tag, 'index.json');
    if (!index) continue;
    meta = meta || index;
    for (const level of index.levels) {
      byVus.set(level.vus, { ...level, sourceTag: tag });
    }
  }
  if (!meta) return null;
  return {
    ...meta,
    tags,
    levels: [...byVus.values()].sort((a, b) => a.vus - b.vus),
  };
}

const main = mergeRuns(['main', 'bisect', 'soak-mixed']);
const realistic = mergeRuns(['realistic', 'realistic-bisect', 'soak-realistic']);
const control = readJson('control', 'index.json');
const socket = readJson('socket', 'socket-results.json');
const scaling = readJson('scaling', 'catalog-scaling.json');
const upload = readJson('upload', 'upload-results.json');
const login = fs.existsSync(path.join(__dirname, '.runtime', 'login-throughput.json'))
  ? JSON.parse(fs.readFileSync(path.join(__dirname, '.runtime', 'login-throughput.json'), 'utf8'))
  : null;

const worst = main && main.levels
  ? main.levels.filter((l) => !l.aborted).slice(-1)[0]
  : null;

const out = [];
out.push('## Configuration A - mixed catalogs (200 / 1,000 / 5,000 products)\n');
out.push(levelTable(main, 'main'));
out.push('\n### System metrics per level (configuration A)\n');
out.push(systemTable(main));
out.push('\n## Configuration B - realistic catalog (200 products)\n');
out.push(levelTable(realistic, 'realistic'));
out.push('\n### System metrics per level (configuration B)\n');
out.push(systemTable(realistic));
if (control) {
  out.push('\n## Control run - single client IP, rate limiter as deployed\n');
  out.push(levelTable(control, 'control'));
}
void worst;
for (const entry of [['A (mixed catalogs)', main], ['B (realistic catalog)', realistic]]) {
  const label = entry[0];
  const run = entry[1];
  if (!run || !run.levels) continue;
  const healthy = run.levels.filter((l) => !l.aborted && l.status === 'PASS').slice(-1)[0];
  const failed = run.levels.filter((l) => !l.aborted && l.status === 'FAIL')[0];
  if (healthy) {
    out.push('\n### Configuration ' + label + ' - endpoints at ' + healthy.vus + ' VUs (highest PASS)\n');
    out.push(endpointTable(healthy));
  }
  if (failed) {
    out.push('\n### Configuration ' + label + ' - endpoints at ' + failed.vus + ' VUs (first FAIL)\n');
    out.push(endpointTable(failed));
  }
}
out.push('\n## Catalog-size scaling (concurrency 1)\n');
out.push(scalingTable(scaling));
out.push('\n## Socket.IO\n');
out.push(socketTables(socket));
out.push('\n## Return-photo upload (Cloudinary)\n');
out.push(uploadTable(upload));
if (login) {
  out.push('\n## Login throughput\n');
  out.push('| Population | Logins | Concurrency | Logins/s | p50 | p95 | max |');
  out.push('| :--- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, row] of Object.entries(login)) {
    out.push('| ' + [name, row.count, row.concurrency, row.loginsPerSecond,
      row.p50Ms + ' ms', row.p95Ms + ' ms', row.maxMs + ' ms'].join(' | ') + ' |');
  }
  out.push('');
}

process.stdout.write(out.join('\n'));
