const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dataPath = path.join(__dirname, '.runtime', 'test-data.json');
const resultPath = path.join(root, 'LOAD_TEST_RESULT.md');
const summaryPath = path.join(__dirname, 'results', 'k6-summary.json');
const k6 = process.platform === 'win32' ? 'k6.exe' : 'k6';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error && result.error.code === 'ENOENT') {
    console.error('[load-test] k6 is not installed or not on PATH. Install from https://grafana.com/docs/k6/latest/set-up/install-k6/');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

function ensureK6() {
  const result = spawnSync(k6, ['version'], { stdio: 'ignore', env: process.env });
  if (result.error && result.error.code === 'ENOENT') {
    console.error('[load-test] k6 is not installed or not on PATH. Install from https://grafana.com/docs/k6/latest/set-up/install-k6/');
    process.exit(1);
  }
}

function prepare() {
  run(process.execPath, [path.join(__dirname, 'setup', 'prepare-test-data.js')]);
  if (!fs.existsSync(dataPath)) throw new Error('Preparation completed without runtime data.');
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

function writeReport(data) {
  const metric = (name) => data.metrics && data.metrics[name] ? data.metrics[name].values : {};
  const duration = metric('http_req_duration');
  const requests = metric('http_reqs');
  const failed = metric('http_req_failed');
  const checks = metric('checks');
  const endpointRows = Object.entries(data.metrics || {})
    .filter(([name]) => name.startsWith('endpoint_latency{endpoint:'))
    .map(([name, value]) => ({ name, p95: value.values['p(95)'] || 0 }))
    .sort((left, right) => right.p95 - left.p95)
    .slice(0, 10);
  const lines = [
    '# Phoenix Load Test Result', '',
    '**Generated from the k6 summary. No values are fabricated.**', '',
    `- Profile: ${process.env.TEST_PROFILE || 'smoke'}`,
    `- VUs: ${process.env.VUS || (process.env.TEST_PROFILE === 'load' ? 'up to 2000' : '5')}`,
    `- Duration: ${process.env.DURATION || (process.env.TEST_PROFILE === 'load' ? 'ramp profile' : '30s')}`,
    `- Warehouses: ${(data.setup && data.setup.warehouses) || '5 discovered'}`,
    `- Total requests: ${requests.count || 0}`,
    `- Requests/sec: ${(requests.rate || 0).toFixed(2)}`,
    `- Iterations: ${(metric('iterations').count || 0)}`,
    `- Average latency: ${(duration.avg || 0).toFixed(2)} ms`,
    `- Median latency: ${(duration.med || 0).toFixed(2)} ms`,
    `- p90: ${(duration['p(90)'] || 0).toFixed(2)} ms`,
    `- p95: ${(duration['p(95)'] || 0).toFixed(2)} ms`,
    `- p99: ${(duration['p(99)'] || 0).toFixed(2)} ms`,
    `- Max latency: ${(duration.max || 0).toFixed(2)} ms`,
    `- Error rate: ${((failed.rate || 0) * 100).toFixed(2)}%`,
    `- Failed requests: ${Math.round((failed.rate || 0) * (requests.count || 0))}`,
    `- HTTP 4xx: ${(metric('http_4xx').count || 0)}`,
    `- HTTP 5xx: ${(metric('http_5xx').count || 0)}`,
    `- Checks: ${((checks.rate || 0) * 100).toFixed(2)}%`, '',
    '## Slowest Endpoints', '',
    'The raw k6 summary is saved at `load-tests/results/k6-summary.json`.',
    ...(endpointRows.length ? endpointRows.map((row) => `- ${row.name}: p95 ${row.p95.toFixed(2)} ms`) : ['- Endpoint-tagged latency metrics were not emitted by this k6 version.']), '',
    '## Execution', '',
    'This report is generated only after an explicit `npm run load-test` or `npm run load-test:2000` command.',
  ];
  fs.writeFileSync(resultPath, `${lines.join('\n')}\n`);
}

ensureK6();
const prepared = prepare();
const args = ['run', '-e', `BASE_URL=${prepared.baseUrl}`, '-e', `TEST_USERS_JSON=${JSON.stringify(prepared.users)}`,
  '-e', `TEST_PRODUCT_ID=${prepared.products[0].productId}`, ...prepared.warehouseIds.flatMap((id, index) => ['-e', `WAREHOUSE_${index + 1}_ID=${id}`]),
  '-e', `RESULT_JSON=${summaryPath}`, path.join('load-tests', 'main.js')];
run(k6, args);
if (fs.existsSync(summaryPath)) writeReport(JSON.parse(fs.readFileSync(summaryPath, 'utf8')));