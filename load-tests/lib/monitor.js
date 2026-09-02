/**
 * Samples everything outside k6's view while a load level runs, and writes one
 * JSON object per sample to a JSONL file.
 *
 * Four independent sources, because no single one of them can attribute a
 * slowdown on its own:
 *   probe   - the backend process itself: event-loop lag, its own CPU/RSS,
 *             libuv handles, and the MongoDB driver's connection-pool events
 *             (load-tests/instrument/probe.js, preloaded with `node -r`).
 *   mongo   - serverStatus() from a separate client: connections, opcounters,
 *             queues, and the WiredTiger cache.
 *   machine - os.cpus() deltas, so backend CPU can be separated from the CPU
 *             the load generator itself is burning on the same laptop.
 *   procs   - per-process CPU/RSS for node, mongod and k6, sampled by one
 *             long-lived PowerShell loop (spawning powershell per sample would
 *             cost more than it measures).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const backendDir = path.resolve(__dirname, '..', '..', 'backend');
const { MongoClient } = require(require.resolve('mongodb', { paths: [backendDir] }));

const PROBE_URL = process.env.PROBE_URL || 'http://127.0.0.1:9999/';
const MONGO_URI = process.env.LOAD_TEST_MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.LOAD_TEST_DB || 'phoenix';

function cpuTotals() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const key of Object.keys(cpu.times)) total += cpu.times[key];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

// One PowerShell process for the whole level. It prints a CSV line per sample
// with each process group's cumulative CPU seconds; deltas are computed here.
//
// TotalProcessorTime is a TimeSpan, and Measure-Object cannot sum those - it
// silently returns 0. Projecting .TotalSeconds first is what makes the CPU
// columns real numbers instead of zeros.
const PS_SAMPLER = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  foreach ($n in @('node','mongod','k6')) {
    $ps = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
    if ($ps.Count -gt 0) {
      $cpu = ($ps | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
      $ws  = ($ps | ForEach-Object { $_.WorkingSet64 } | Measure-Object -Sum).Sum
      $th  = ($ps | ForEach-Object { $_.Threads.Count } | Measure-Object -Sum).Sum
      Write-Output ("$ts,$n,$($ps.Count),$cpu,$ws,$th")
    }
  }
  Write-Output "$ts,--tick--,0,0,0,0"
  Start-Sleep -Milliseconds 2000
}
`;

class Monitor {
  constructor(outputPath) {
    this.outputPath = outputPath;
    this.samples = [];
    this.procState = new Map();
    this.stopped = false;
  }

  async start() {
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    this.stream = fs.createWriteStream(this.outputPath, { flags: 'w' });

    this.mongoClient = new MongoClient(MONGO_URI, { maxPoolSize: 2 });
    await this.mongoClient.connect();
    this.db = this.mongoClient.db(DB_NAME);

    this.lastCpu = cpuTotals();

    this.ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SAMPLER], {
      windowsHide: true,
    });
    this.procLatest = {};
    let buffer = '';
    this.ps.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const [ts, name, count, cpu, ws, threads] = line.trim().split(',');
        if (!name || name === '--tick--') continue;
        const tsNum = Number(ts);
        const prev = this.procState.get(name);
        // Already seconds - the sampler projects TimeSpan.TotalSeconds.
        const cpuSeconds = Number(cpu);
        if (prev && tsNum > prev.ts) {
          const wallSec = (tsNum - prev.ts) / 1000;
          const usedSec = cpuSeconds - prev.cpuSeconds;
          this.procLatest[name] = {
            processes: Number(count),
            cpuPercentOfMachine: Number(((usedSec / wallSec / os.cpus().length) * 100).toFixed(2)),
            cpuPercentOfOneCore: Number(((usedSec / wallSec) * 100).toFixed(2)),
            rssMb: Number((Number(ws) / 1048576).toFixed(1)),
            threads: Number(threads),
          };
        }
        this.procState.set(name, { ts: tsNum, cpuSeconds });
      }
    });

    this.timer = setInterval(() => { this.sample().catch(() => {}); }, 2000);
  }

  async sample() {
    if (this.stopped) return;
    const now = cpuTotals();
    const idleDelta = now.idle - this.lastCpu.idle;
    const totalDelta = now.total - this.lastCpu.total;
    this.lastCpu = now;
    const machineCpuPercent = totalDelta > 0
      ? Number((100 - (100 * idleDelta) / totalDelta).toFixed(2))
      : 0;

    let probe = null;
    try {
      const response = await fetch(PROBE_URL, { signal: AbortSignal.timeout(3000) });
      probe = await response.json();
    } catch (error) {
      probe = { error: error.message };
    }

    let mongo = null;
    try {
      const status = await this.db.admin().serverStatus();
      mongo = {
        connectionsCurrent: status.connections.current,
        connectionsAvailable: status.connections.available,
        connectionsTotalCreated: status.connections.totalCreated,
        activeClientsReaders: status.globalLock && status.globalLock.activeClients
          ? status.globalLock.activeClients.readers : null,
        activeClientsWriters: status.globalLock && status.globalLock.activeClients
          ? status.globalLock.activeClients.writers : null,
        currentQueueTotal: status.globalLock && status.globalLock.currentQueue
          ? status.globalLock.currentQueue.total : null,
        opQuery: status.opcounters.query,
        opInsert: status.opcounters.insert,
        opUpdate: status.opcounters.update,
        opCommand: status.opcounters.command,
        residentMb: status.mem ? status.mem.resident : null,
        virtualMb: status.mem ? status.mem.virtual : null,
        wtCacheUsedMb: status.wiredTiger
          ? Number((status.wiredTiger.cache['bytes currently in the cache'] / 1048576).toFixed(1))
          : null,
        wtCacheMaxMb: status.wiredTiger
          ? Number((status.wiredTiger.cache['maximum bytes configured'] / 1048576).toFixed(1))
          : null,
        // WiredTiger concurrency tickets. `available` alone is meaningless
        // without `totalTickets`: MongoDB 7 sizes this pool dynamically, so a
        // low `available` can mean either saturation or simply a small pool.
        wtReadTicketsAvailable: status.wiredTiger && status.wiredTiger.concurrentTransactions
          ? status.wiredTiger.concurrentTransactions.read.available : null,
        wtReadTicketsTotal: status.wiredTiger && status.wiredTiger.concurrentTransactions
          ? status.wiredTiger.concurrentTransactions.read.totalTickets : null,
        wtReadTicketsOut: status.wiredTiger && status.wiredTiger.concurrentTransactions
          ? status.wiredTiger.concurrentTransactions.read.out : null,
        wtWriteTicketsAvailable: status.wiredTiger && status.wiredTiger.concurrentTransactions
          ? status.wiredTiger.concurrentTransactions.write.available : null,
        wtWriteTicketsTotal: status.wiredTiger && status.wiredTiger.concurrentTransactions
          ? status.wiredTiger.concurrentTransactions.write.totalTickets : null,
        wtWriteTicketsOut: status.wiredTiger && status.wiredTiger.concurrentTransactions
          ? status.wiredTiger.concurrentTransactions.write.out : null,
      };
    } catch (error) {
      mongo = { error: error.message };
    }

    const sample = {
      t: Date.now(),
      machineCpuPercent,
      freeMemMb: Number((os.freemem() / 1048576).toFixed(0)),
      probe,
      mongo,
      procs: { ...this.procLatest },
    };
    this.samples.push(sample);
    this.stream.write(JSON.stringify(sample) + '\n');
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.ps) this.ps.kill();
    if (this.stream) await new Promise((resolve) => this.stream.end(resolve));
    if (this.mongoClient) await this.mongoClient.close();
    return this.samples;
  }

  // Aggregates the level's samples into the handful of numbers the report
  // needs. Only samples taken during the steady-state window are considered
  // when one is given, so ramp-up noise does not pull the peaks down.
  summarize(fromTs, toTs) {
    const window = this.samples.filter((s) => (!fromTs || s.t >= fromTs) && (!toTs || s.t <= toTs));
    const rows = window.length ? window : this.samples;
    if (!rows.length) return null;
    const nums = (fn) => rows.map(fn).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const max = (values) => (values.length ? Math.max(...values) : null);
    const avg = (values) => (values.length
      ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null);

    const probeOk = rows.filter((s) => s.probe && !s.probe.error);
    const mongoOk = rows.filter((s) => s.mongo && !s.mongo.error);
    const last = probeOk[probeOk.length - 1];
    const first = probeOk[0];

    return {
      samples: rows.length,
      machineCpuAvgPercent: avg(nums((s) => s.machineCpuPercent)),
      machineCpuMaxPercent: max(nums((s) => s.machineCpuPercent)),
      freeMemMinMb: rows.length ? Math.min(...nums((s) => s.freeMemMb)) : null,
      backend: {
        cpuAvgPercentOfOneCore: avg(probeOk.map((s) => s.probe.cpu.percentOfOneCore)),
        cpuMaxPercentOfOneCore: max(probeOk.map((s) => s.probe.cpu.percentOfOneCore)),
        cpuAvgPercentOfMachine: avg(probeOk.map((s) => s.probe.cpu.percentOfMachine)),
        eventLoopMeanMsAvg: avg(probeOk.map((s) => s.probe.eventLoop.meanMs)),
        eventLoopP99MsMax: max(probeOk.map((s) => s.probe.eventLoop.p99Ms)),
        eventLoopMaxMs: max(probeOk.map((s) => s.probe.eventLoop.maxMs)),
        rssMaxMb: max(probeOk.map((s) => s.probe.memory.rssMb)),
        heapUsedMaxMb: max(probeOk.map((s) => s.probe.memory.heapUsedMb)),
        activeHandlesMax: max(probeOk.map((s) => s.probe.handles.activeHandles)),
        poolMaxSize: last ? last.probe.mongoPool.maxPoolSize : null,
        poolConnectionsCreated: last && first
          ? last.probe.mongoPool.created - first.probe.mongoPool.created : null,
        poolCheckOutFailed: last ? last.probe.mongoPool.checkOutFailed : null,
        poolMaxPendingCheckouts: max(probeOk.map((s) => s.probe.mongoPool.maxPendingCheckouts)),
      },
      mongo: {
        connectionsMax: max(mongoOk.map((s) => s.mongo.connectionsCurrent)),
        connectionsAvailableMin: mongoOk.length
          ? Math.min(...mongoOk.map((s) => s.mongo.connectionsAvailable)) : null,
        queueTotalMax: max(mongoOk.map((s) => s.mongo.currentQueueTotal)),
        activeReadersMax: max(mongoOk.map((s) => s.mongo.activeClientsReaders)),
        activeWritersMax: max(mongoOk.map((s) => s.mongo.activeClientsWriters)),
        readTicketsAvailableMin: mongoOk.length && mongoOk[0].mongo.wtReadTicketsAvailable != null
          ? Math.min(...mongoOk.map((s) => s.mongo.wtReadTicketsAvailable)) : null,
        readTicketsTotal: mongoOk.length ? mongoOk[mongoOk.length - 1].mongo.wtReadTicketsTotal : null,
        readTicketsOutMax: max(mongoOk.map((s) => s.mongo.wtReadTicketsOut)),
        writeTicketsAvailableMin: mongoOk.length && mongoOk[0].mongo.wtWriteTicketsAvailable != null
          ? Math.min(...mongoOk.map((s) => s.mongo.wtWriteTicketsAvailable)) : null,
        writeTicketsTotal: mongoOk.length ? mongoOk[mongoOk.length - 1].mongo.wtWriteTicketsTotal : null,
        writeTicketsOutMax: max(mongoOk.map((s) => s.mongo.wtWriteTicketsOut)),
        residentMaxMb: max(mongoOk.map((s) => s.mongo.residentMb)),
        wtCacheUsedMaxMb: max(mongoOk.map((s) => s.mongo.wtCacheUsedMb)),
        // Query/command counters are cumulative; the delta over the window is
        // the level's actual database throughput.
        queriesInWindow: mongoOk.length > 1
          ? mongoOk[mongoOk.length - 1].mongo.opQuery - mongoOk[0].mongo.opQuery : null,
        commandsInWindow: mongoOk.length > 1
          ? mongoOk[mongoOk.length - 1].mongo.opCommand - mongoOk[0].mongo.opCommand : null,
        insertsInWindow: mongoOk.length > 1
          ? mongoOk[mongoOk.length - 1].mongo.opInsert - mongoOk[0].mongo.opInsert : null,
        windowSeconds: mongoOk.length > 1
          ? Number(((mongoOk[mongoOk.length - 1].t - mongoOk[0].t) / 1000).toFixed(1)) : null,
      },
      processes: {
        nodeCpuMaxPercentOfMachine: max(rows.map((s) => s.procs.node && s.procs.node.cpuPercentOfMachine)),
        nodeRssMaxMb: max(rows.map((s) => s.procs.node && s.procs.node.rssMb)),
        mongodCpuMaxPercentOfMachine: max(rows.map((s) => s.procs.mongod && s.procs.mongod.cpuPercentOfMachine)),
        mongodRssMaxMb: max(rows.map((s) => s.procs.mongod && s.procs.mongod.rssMb)),
        k6CpuMaxPercentOfMachine: max(rows.map((s) => s.procs.k6 && s.procs.k6.cpuPercentOfMachine)),
        k6CpuAvgPercentOfMachine: avg(nums((s) => s.procs.k6 && s.procs.k6.cpuPercentOfMachine)),
        k6RssMaxMb: max(rows.map((s) => s.procs.k6 && s.procs.k6.rssMb)),
      },
    };
  }
}

module.exports = { Monitor };
