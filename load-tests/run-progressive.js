/**
 * Phase 4/5 driver: runs the HTTP suite at one load level at a time, with a
 * real ramp and a steady-state hold at each, collecting backend / MongoDB /
 * machine metrics alongside k6's own, and stops escalating once a level fails.
 *
 *   node run-progressive.js                       full sweep
 *   node run-progressive.js --levels 100,250      only those levels
 *   node run-progressive.js --tag control --no-ip-simulation
 *
 * Results land in results/<tag>/level-<vus>.json plus results/<tag>/index.json.
 * Nothing here writes to the application; the only state it changes is what
 * the write scenarios create through the public API, all of it tagged and
 * removable with `node setup/seed-load-data.js --clean`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Monitor } = require('./lib/monitor');
const { bands } = require('./thresholds.js');

const ROOT = path.resolve(__dirname, '..');
const K6 = process.platform === 'win32' ? 'k6.exe' : 'k6';

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
function flag(name) {
  return process.argv.includes('--' + name);
}

const TAG = arg('tag', 'main');
const RESULT_DIR = path.join(__dirname, 'results', TAG);

// Ramp and hold per level (Phase 5): a bigger step gets a longer ramp, so the
// system is never handed thousands of new connections at once, and every level
// holds long enough for its steady window to contain real signal.
const LEVEL_PLAN = {
  10: { ramp: '10s', hold: '60s' },
  25: { ramp: '10s', hold: '60s' },
  50: { ramp: '15s', hold: '60s' },
  100: { ramp: '30s', hold: '60s' },
  250: { ramp: '45s', hold: '90s' },
  500: { ramp: '60s', hold: '90s' },
  750: { ramp: '90s', hold: '90s' },
  1000: { ramp: '120s', hold: '120s' },
  1500: { ramp: '150s', hold: '120s' },
  2000: { ramp: '180s', hold: '120s' },
  3000: { ramp: '180s', hold: '120s' },
  5000: { ramp: '240s', hold: '120s' },
};
const DEFAULT_LEVELS = [10, 25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000];

function planFor(vus) {
  // An explicit --ramp/--hold always wins over the table. Without this a
  // steady-state soak asked for with --hold 300s silently ran the table's
  // 60s instead, because the level happened to be one of the sweep levels.
  const overrideRamp = arg('ramp', null);
  const overrideHold = arg('hold', null);
  const base = LEVEL_PLAN[vus] || {
    // Interpolated plan for bisection levels, which are not in the table.
    ramp: Math.min(240, Math.max(15, Math.round(vus / 11))) + 's',
    hold: '120s',
  };
  return {
    ramp: overrideRamp || base.ramp,
    hold: overrideHold || base.hold,
  };
}

function toSeconds(duration) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(duration);
  if (!match) return 0;
  const value = Number(match[1]);
  return match[2] === 'ms' ? value / 1000 : match[2] === 'm' ? value * 60 : value;
}

function metric(summary, name) {
  const entry = summary.metrics[name];
  return entry ? entry.values : null;
}

// Steady-window values where available, whole-run values as the fallback (a
// level that never reached steady state, e.g. because k6 aborted).
function readLevel(summary) {
  const steadyDuration = metric(summary, 'http_req_duration{phase:steady}');
  const duration = steadyDuration && steadyDuration.max > 0
    ? steadyDuration : metric(summary, 'http_req_duration');
  const usedSteady = Boolean(steadyDuration && steadyDuration.max > 0);

  const steadyReqs = metric(summary, 'http_reqs{phase:steady}');
  const allReqs = metric(summary, 'http_reqs');
  const reqs = usedSteady && steadyReqs && steadyReqs.count > 0 ? steadyReqs : allReqs;

  const steadyFailed = metric(summary, 'http_req_failed{phase:steady}');
  const failed = usedSteady && steadyFailed ? steadyFailed : metric(summary, 'http_req_failed');

  const counter = (name) => {
    const steady = metric(summary, name + '{phase:steady}');
    const all = metric(summary, name);
    const chosen = usedSteady && steady ? steady : all;
    return chosen ? chosen.count : 0;
  };

  return {
    usedSteadyWindow: usedSteady,
    requests: reqs ? reqs.count : 0,
    rps: reqs ? Number(reqs.rate.toFixed(2)) : 0,
    avgMs: duration ? Number(duration.avg.toFixed(1)) : null,
    medMs: duration ? Number(duration.med.toFixed(1)) : null,
    p90Ms: duration ? Number(duration['p(90)'].toFixed(1)) : null,
    p95Ms: duration ? Number(duration['p(95)'].toFixed(1)) : null,
    p99Ms: duration ? Number(duration['p(99)'].toFixed(1)) : null,
    maxMs: duration ? Number(duration.max.toFixed(1)) : null,
    errorRate: failed ? Number(failed.rate.toFixed(5)) : null,
    failedRequests: failed && reqs ? Math.round(failed.rate * reqs.count) : null,
    http4xx: counter('http_4xx'),
    http5xx: counter('http_5xx'),
    http429: counter('http_429'),
    timeouts: counter('http_timeouts'),
    iterations: metric(summary, 'iterations') ? metric(summary, 'iterations').count : 0,
    droppedIterations: metric(summary, 'dropped_iterations')
      ? metric(summary, 'dropped_iterations').count : 0,
    vusMax: metric(summary, 'vus_max') ? metric(summary, 'vus_max').max : null,
  };
}

function readEndpoints(summary) {
  const rows = [];
  for (const [name, entry] of Object.entries(summary.metrics)) {
    const match = /^endpoint_latency\{endpoint:([a-z0-9_]+),phase:steady\}$/.exec(name);
    if (!match) continue;
    const endpoint = match[1];
    const reqs = metric(summary, 'endpoint_reqs{endpoint:' + endpoint + ',phase:steady}');
    const errors = metric(summary, 'endpoint_errors{endpoint:' + endpoint + ',phase:steady}');
    const count = reqs ? reqs.count : 0;
    if (!count) continue;
    rows.push({
      endpoint,
      requests: count,
      rps: reqs ? Number(reqs.rate.toFixed(2)) : 0,
      avgMs: Number(entry.values.avg.toFixed(1)),
      medMs: Number(entry.values.med.toFixed(1)),
      p95Ms: Number(entry.values['p(95)'].toFixed(1)),
      p99Ms: Number(entry.values['p(99)'].toFixed(1)),
      maxMs: Number(entry.values.max.toFixed(1)),
      errors: errors ? errors.count : 0,
      errorRate: count ? Number(((errors ? errors.count : 0) / count).toFixed(4)) : 0,
    });
  }
  return rows.sort((a, b) => b.p95Ms - a.p95Ms);
}

// Phase 7 grading. A level is only PASS when both error rate and p95 are in
// the healthy band; anything past the degraded band, or any p99 beyond the
// serious-degradation line combined with a non-trivial error rate, is FAIL.
function classify(level) {
  const reasons = [];
  let status = 'PASS';
  const worse = (next) => {
    const order = { PASS: 0, DEGRADED: 1, FAIL: 2 };
    if (order[next] > order[status]) status = next;
  };

  if (level.errorRate === null) {
    return { status: 'FAIL', reasons: ['no metrics produced'] };
  }
  if (level.errorRate > bands.errorRate.degraded) {
    worse('FAIL');
    reasons.push('error rate ' + (level.errorRate * 100).toFixed(2) + '% > 5%');
  } else if (level.errorRate > bands.errorRate.healthy) {
    worse('DEGRADED');
    reasons.push('error rate ' + (level.errorRate * 100).toFixed(2) + '% in 1-5% band');
  }

  if (level.p95Ms > bands.p95Ms.degraded) {
    worse('FAIL');
    reasons.push('p95 ' + level.p95Ms + 'ms > 1000ms');
  } else if (level.p95Ms > bands.p95Ms.healthy) {
    worse('DEGRADED');
    reasons.push('p95 ' + level.p95Ms + 'ms in 500-1000ms band');
  }

  if (level.p99Ms > bands.p99Ms.seriousMs) {
    worse(status === 'PASS' ? 'DEGRADED' : status);
    reasons.push('p99 ' + level.p99Ms + 'ms > 2000ms (serious degradation)');
  }
  if (level.http5xx > 0) {
    worse('DEGRADED');
    reasons.push(level.http5xx + ' x 5xx');
  }
  if (level.timeouts > 0) {
    worse(level.timeouts > level.requests * 0.01 ? 'FAIL' : 'DEGRADED');
    reasons.push(level.timeouts + ' timeouts/connection errors');
  }
  if (level.droppedIterations > 0) {
    reasons.push(level.droppedIterations + ' dropped iterations (load generator could not keep up)');
  }
  if (reasons.length === 0) reasons.push('within healthy bands');
  return { status, reasons };
}

function runK6(vus, plan, summaryPath) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      VUS: String(vus),
      RAMP: plan.ramp,
      HOLD: plan.hold,
      RAMP_DOWN: '10s',
      RESULT_JSON: summaryPath,
      RUN_WRITE_SCENARIOS: process.env.RUN_WRITE_SCENARIOS || 'true',
      SIMULATE_CLIENT_IPS: flag('no-ip-simulation') ? 'false' : 'true',
      // --catalog-sizes exists so this works identically from cmd.exe, where
      // an inline `VAR=value command` prefix is not valid syntax.
      CATALOG_SIZES: arg('catalog-sizes', process.env.CATALOG_SIZES || ''),
    };
    const args = ['run', '--quiet', '--no-usage-report', path.join('load-tests', 'main.js')];
    const child = spawn(K6, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function healthy() {
  try {
    const response = await fetch((process.env.BASE_URL || 'http://localhost:5000/api') + '/health',
      { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const body = await response.json();
    return body.db === 'connected';
  } catch (_) {
    return false;
  }
}

async function runLevel(vus) {
  const plan = planFor(vus);
  const rampSec = toSeconds(plan.ramp);
  const holdSec = toSeconds(plan.hold);
  console.log('\n=== LEVEL ' + vus + ' VUs  (ramp ' + plan.ramp + ', steady ' + plan.hold + ') ===');

  if (!(await healthy())) {
    console.log('  backend unhealthy before level - aborting sweep');
    return { vus, aborted: true, reason: 'backend unhealthy before level' };
  }

  const monitorPath = path.join(RESULT_DIR, 'monitor-' + vus + '.jsonl');
  const monitor = new Monitor(monitorPath);
  await monitor.start();
  // Zero the event-loop histogram and the pool's high-water marks so each
  // level's figures describe that level and not everything before it.
  try { await fetch('http://127.0.0.1:9999/reset', { signal: AbortSignal.timeout(2000) }); } catch (_) { /* probe optional */ }

  const startedAt = Date.now();
  const summaryPath = path.join(RESULT_DIR, 'k6-' + vus + '.json');
  const result = await runK6(vus, plan, summaryPath);
  const finishedAt = Date.now();

  const steadyFrom = startedAt + rampSec * 1000;
  const steadyTo = steadyFrom + holdSec * 1000;
  const system = monitor.summarize(steadyFrom, Math.min(steadyTo, finishedAt));
  await monitor.stop();

  if (!fs.existsSync(summaryPath)) {
    console.log('  k6 produced no summary (exit ' + result.code + ')');
    console.log('  stderr: ' + result.stderr.slice(0, 800));
    return { vus, aborted: true, reason: 'k6 produced no summary', stderr: result.stderr.slice(0, 2000) };
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const level = readLevel(summary);
  const endpoints = readEndpoints(summary);
  const verdict = classify(level);
  const backendHealthy = await healthy();

  const record = {
    vus,
    plan,
    startedAt: new Date(startedAt).toISOString(),
    durationSec: Number(((finishedAt - startedAt) / 1000).toFixed(1)),
    k6ExitCode: result.code,
    backendHealthyAfter: backendHealthy,
    ...level,
    status: verdict.status,
    reasons: verdict.reasons,
    endpoints,
    system,
  };
  fs.writeFileSync(path.join(RESULT_DIR, 'level-' + vus + '.json'), JSON.stringify(record, null, 2));

  console.log(
    '  ' + verdict.status.padEnd(8) +
    ' rps=' + String(level.rps).padStart(7) +
    ' p95=' + String(level.p95Ms).padStart(7) + 'ms' +
    ' p99=' + String(level.p99Ms).padStart(8) + 'ms' +
    ' err=' + (level.errorRate * 100).toFixed(2) + '%' +
    ' 5xx=' + level.http5xx + ' 429=' + level.http429 + ' t/o=' + level.timeouts
  );
  if (system) {
    console.log(
      '           machineCPU=' + system.machineCpuAvgPercent + '%' +
      ' backendCPU=' + system.backend.cpuAvgPercentOfOneCore + '% of 1 core' +
      ' k6CPU=' + system.processes.k6CpuAvgPercentOfMachine + '% of machine' +
      ' loopLag(mean)=' + (system.backend.eventLoopMeanMsAvg || 0).toFixed(1) + 'ms' +
      ' mongoConns=' + system.mongo.connectionsMax
    );
  }
  console.log('           ' + verdict.reasons.join('; '));
  return record;
}

async function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const levels = arg('levels', null)
    ? arg('levels').split(',').map((v) => Number(v.trim())).filter(Boolean)
    : DEFAULT_LEVELS;
  const cooldownSec = Number(arg('cooldown', '20'));

  console.log('Phoenix progressive load test');
  console.log('  tag:        ' + TAG);
  console.log('  levels:     ' + levels.join(', '));
  console.log('  client IPs: ' + (flag('no-ip-simulation') ? 'single (control run)' : 'simulated per request'));
  console.log('  writes:     ' + (process.env.RUN_WRITE_SCENARIOS || 'true'));

  const results = [];
  for (const vus of levels) {
    const record = await runLevel(vus);
    results.push(record);
    fs.writeFileSync(path.join(RESULT_DIR, 'index.json'), JSON.stringify({
      tag: TAG,
      generatedAt: new Date().toISOString(),
      ipSimulation: !flag('no-ip-simulation'),
      levels: results,
    }, null, 2));

    if (record.aborted) break;
    if (record.status === 'FAIL' && !flag('force')) {
      console.log('\n  Level ' + vus + ' FAILED - stopping escalation (Phase 4: do not keep');
      console.log('  piling load onto an already-overloaded system). Use --force to override,');
      console.log('  or --levels to bisect between the last PASS and this level.');
      break;
    }
    if (levels.indexOf(vus) < levels.length - 1) {
      console.log('  cooling down ' + cooldownSec + 's');
      await new Promise((resolve) => setTimeout(resolve, cooldownSec * 1000));
    }
  }

  console.log('\nSweep complete. Results in ' + RESULT_DIR);
}

main().catch((error) => {
  console.error('runner FAILED: ' + error.message);
  console.error(error.stack);
  process.exitCode = 1;
});
