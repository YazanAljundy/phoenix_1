/**
 * Return-photo upload stress test - deliberately separate from the main HTTP
 * suite, and deliberately small.
 *
 * POST /returns is the only pharmacist-facing multipart endpoint. Its
 * controller (return.controller.js) verifies each buffer's magic bytes and
 * then streams every photo to Cloudinary BEFORE the return itself is
 * validated, so each request's latency is dominated by a third-party round
 * trip that the Phoenix backend does not control.
 *
 * That is why this is not folded into the 2,000-VU sweep: at that
 * concurrency the test would stop measuring Phoenix and start hammering the
 * project's own Cloudinary account, spending real quota against an external
 * provider. What is measured here instead is the per-request cost and how it
 * degrades over a handful of concurrency steps - enough to place Cloudinary
 * in the bottleneck ordering without abusing it.
 *
 * Every return it creates is deleted again through DELETE /returns/:id, which
 * is also the path that removes the uploaded Cloudinary assets
 * (return.service.js deleteReturn -> deleteImages).
 *
 *   node upload-load.js                       default: 1/4/8 concurrency, 8 each
 *   node upload-load.js --levels 1,4 --per 6 --kb 200
 *   node upload-load.js --no-cleanup          keep the returns (not recommended)
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Monitor } = require('./lib/monitor');

const RUNTIME = path.join(__dirname, '.runtime');
const fixtures = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'load-fixtures.json'), 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'tokens.json'), 'utf8'));
const API_BASE = process.env.BASE_URL || fixtures.baseUrl;
const RESULT_DIR = path.join(__dirname, 'results', 'upload');

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

// A real, decodable PNG of the requested rough size. It has to be genuinely
// valid: the controller checks the magic bytes and Cloudinary decodes the
// image, so a buffer of random noise with a PNG header would be rejected
// downstream and the test would measure an error path.
function makePng(targetKb) {
  const width = 64;
  // Height chosen so raw scanlines land near the requested size; PNG's filter
  // byte per row is included.
  const height = Math.max(64, Math.round((targetKb * 1024) / (width * 3 + 1)));
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      // Noise, so zlib cannot compress it away and the payload keeps its size.
      raw[offset] = (x * 31 + y * 17) & 255;
      raw[offset + 1] = (x * 7 + y * 131) & 255;
      raw[offset + 2] = ((x ^ y) * 97) & 255;
      offset += 3;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 1 });

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (q) => Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1));
  return {
    count: sorted.length,
    minMs: Number(sorted[0].toFixed(1)),
    medMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: Number(sorted[sorted.length - 1].toFixed(1)),
    avgMs: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1)),
  };
}

// Each worker uses its own pharmacy identity and its own delivered order, so
// no two requests contend for the same order (a return is unique per order).
function* targets() {
  for (let p = 0; p < tokens.pharmacyTokens.length; p += 1) {
    const account = tokens.pharmacyTokens[p];
    const orderIds = fixtures.deliveredOrdersByPhone[account.phone] || [];
    for (const orderId of orderIds) yield { token: account.token, orderId };
  }
}

async function createReturn(target, png, orderItemId, ip) {
  const form = new FormData();
  form.append('orderId', target.orderId);
  form.append('notes', '[LOADTEST] upload scenario');
  form.append('items', JSON.stringify([
    { orderItemId, quantity: 1, reasonType: 'damaged' },
  ]));
  form.append('images', new Blob([png], { type: 'image/png' }), 'photo.png');

  const started = Date.now();
  const response = await fetch(API_BASE + '/returns', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + target.token, 'X-Forwarded-For': ip },
    body: form,
  });
  const ms = Date.now() - started;
  let body = null;
  try { body = await response.json(); } catch (_) { /* error text is enough */ }
  return { ok: response.ok, status: response.status, ms, body };
}

// The return's items reference OrderItem ids, which are only visible through
// the order detail endpoint.
async function orderItemIdFor(target, ip) {
  const response = await fetch(API_BASE + '/orders/' + target.orderId, {
    headers: { Authorization: 'Bearer ' + target.token, 'X-Forwarded-For': ip },
  });
  if (!response.ok) return null;
  const body = await response.json();
  const items = body.order && body.order.items ? body.order.items : body.items;
  if (!Array.isArray(items) || !items.length) return null;
  return items[0].id || items[0]._id;
}

async function runLevel(concurrency, perWorker, png, iterator, created) {
  console.log('\n=== UPLOAD concurrency ' + concurrency + ', ' + perWorker + ' requests each ===');
  const monitor = new Monitor(path.join(RESULT_DIR, 'monitor-upload-' + concurrency + '.jsonl'));
  await monitor.start();

  const latencies = [];
  const failures = [];
  let ipSeq = 0;
  const startedAt = Date.now();

  async function worker(workerIndex) {
    for (let i = 0; i < perWorker; i += 1) {
      const next = iterator.next();
      if (next.done) return;
      const target = next.value;
      ipSeq += 1;
      const ip = '10.210.' + ((ipSeq >> 8) & 255) + '.' + (ipSeq & 255);
      const orderItemId = await orderItemIdFor(target, ip);
      if (!orderItemId) {
        failures.push({ reason: 'no order item', workerIndex });
        continue;
      }
      const result = await createReturn(target, png, orderItemId, ip);
      if (result.ok) {
        latencies.push(result.ms);
        const id = result.body && result.body.return
          ? (result.body.return.id || result.body.return._id) : null;
        if (id) created.push({ id, token: target.token });
      } else {
        failures.push({
          status: result.status,
          message: result.body && result.body.message,
          ms: result.ms,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const system = monitor.summarize(startedAt, Date.now());
  await monitor.stop();

  const record = {
    concurrency,
    requested: concurrency * perWorker,
    succeeded: latencies.length,
    failed: failures.length,
    imageBytes: png.length,
    uploadsPerSecond: Number((latencies.length / elapsedSec).toFixed(2)),
    elapsedSec: Number(elapsedSec.toFixed(2)),
    latency: stats(latencies),
    failures: failures.slice(0, 10),
    system,
  };
  console.log('  ' + record.succeeded + '/' + record.requested + ' succeeded, ' +
    record.uploadsPerSecond + ' uploads/s, ' +
    'p95=' + (record.latency ? record.latency.p95Ms : 'n/a') + 'ms, ' +
    'med=' + (record.latency ? record.latency.medMs : 'n/a') + 'ms');
  if (system) {
    console.log('  backend cpu=' + system.backend.cpuAvgPercentOfOneCore + '% of 1 core' +
      ' loopLag(mean)=' + (system.backend.eventLoopMeanMsAvg || 0).toFixed(1) + 'ms' +
      ' rss=' + system.backend.rssMaxMb + 'MB');
  }
  if (failures.length) console.log('  first failures: ' + JSON.stringify(record.failures.slice(0, 3)));
  return record;
}

// Baseline for attribution: the same account writing an order, which runs the
// identical auth + pharmacy-lookup + validation + Mongo write path with no
// Cloudinary hop. The difference between the two is the upload cost.
async function orderBaseline(count) {
  const account = tokens.pharmacyTokens[0];
  const latencies = [];
  for (let i = 0; i < count; i += 1) {
    const started = Date.now();
    const response = await fetch(API_BASE + '/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + account.token,
        'X-Forwarded-For': '10.211.0.' + (i & 255),
      },
      body: JSON.stringify({
        warehouseId: fixtures.orderTargetWarehouseId,
        items: [{ productId: fixtures.orderTargetProductIds[i % fixtures.orderTargetProductIds.length], quantity: 1 }],
        notes: '[LOADTEST] upload baseline',
      }),
    });
    if (response.ok) latencies.push(Date.now() - started);
    await response.arrayBuffer();
  }
  return stats(latencies);
}

async function cleanup(created) {
  let deleted = 0;
  let failed = 0;
  for (const entry of created) {
    try {
      const response = await fetch(API_BASE + '/returns/' + entry.id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + entry.token, 'X-Forwarded-For': '10.212.0.1' },
      });
      if (response.ok) deleted += 1; else failed += 1;
    } catch (_) {
      failed += 1;
    }
  }
  return { deleted, failed };
}

async function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const levels = arg('levels', '1,4,8').split(',').map(Number).filter(Boolean);
  const perWorker = Number(arg('per', '8'));
  const kb = Number(arg('kb', '120'));
  const png = makePng(kb);
  console.log('Upload stress test');
  console.log('  image: ' + png.length + ' bytes (valid PNG, ' + kb + 'KB target)');
  console.log('  total uploads planned: ' + levels.reduce((a, c) => a + c * perWorker, 0));

  const baseline = await orderBaseline(10);
  console.log('  POST /orders baseline (no upload): med=' + baseline.medMs + 'ms p95=' + baseline.p95Ms + 'ms');

  const iterator = targets();
  const created = [];
  const results = [];
  for (const concurrency of levels) {
    results.push(await runLevel(concurrency, perWorker, png, iterator, created));
  }

  let cleanupResult = { skipped: true };
  if (!process.argv.includes('--no-cleanup')) {
    console.log('\nDeleting the ' + created.length + ' returns this test created ' +
      '(also removes their Cloudinary assets)...');
    cleanupResult = await cleanup(created);
    console.log('  deleted ' + cleanupResult.deleted + ', failed ' + cleanupResult.failed);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    imageBytes: png.length,
    orderWriteBaseline: baseline,
    levels: results,
    cleanup: cleanupResult,
  };
  fs.writeFileSync(path.join(RESULT_DIR, 'upload-results.json'), JSON.stringify(output, null, 2));
  console.log('\nUpload results written to ' + path.join(RESULT_DIR, 'upload-results.json'));
}

main().catch((error) => {
  console.error('upload-load FAILED: ' + error.message);
  console.error(error.stack);
  process.exitCode = 1;
});
