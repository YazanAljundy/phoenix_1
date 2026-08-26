const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const baseUrl = ('http://localhost:5000/api').replace(/\/$/, '');
const runWrites = process.env.RUN_WRITE_SCENARIOS === 'true';
const allowProtected = process.env.ALLOW_PROTECTED_TARGET === 'true';
const outputPath = path.resolve(process.env.LOAD_TEST_DATA || path.join(__dirname, '..', '.runtime', 'test-data.json'));

function targetIsLocal() {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  return ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
}

function fail(message) { throw new Error(`[load-test setup] ${message}`); }
async function request(method, url, body, token) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await response.json(); } catch (_) { /* diagnostic below is enough */ }
  return { response, data };
}
function idOf(value) { return String(value && (value.id || value._id || value)); }
function phoneFor(index) {
  const prefix = process.env.TEST_PHONE_PREFIX || '099';
  return `${prefix}${String(Date.now()).slice(-5)}${String(index).padStart(2, '0')}`;
}

async function healthCheck() {
  try {
    const { response } = await request('GET', `${baseUrl}/health`);
    if (!response.ok) fail(`Backend health check returned HTTP ${response.status}.`);
  } catch (error) { fail(`Backend unreachable at ${baseUrl}. Start the local backend and check BASE_URL. ${error.message}`); }
}

async function discoverWarehouses(token) {
  const { response, data } = await request('GET', `${baseUrl}/warehouses`, undefined, token);
  if (response.status === 401 || response.status === 403) {
    fail(`Warehouse discovery requires an active pharmacy test user (HTTP ${response.status}). The registration API creates pending users; approve the generated test account in the local test environment, then rerun this command.`);
  }
  if (!response.ok) fail(`Warehouse discovery failed with HTTP ${response.status}.`);
  const warehouses = data && Array.isArray(data.warehouses) ? data.warehouses : [];
  if (warehouses.length < 5) fail(`Only ${warehouses.length} warehouses were found; at least 5 are required for this test.`);
  return warehouses.slice(0, 5).map((warehouse) => idOf(warehouse));
}

async function discoverProducts(token, warehouseIds) {
  const products = [];
  for (const warehouseId of warehouseIds) {
    const { response, data } = await request('GET', `${baseUrl}/warehouses/${warehouseId}/products?limit=20`, undefined, token);
    if (!response.ok) fail(`Product discovery failed for warehouse ${warehouseId} with HTTP ${response.status}.`);
    const rows = data && Array.isArray(data.products) ? data.products : [];
    if (rows.length) products.push({ warehouseId, productId: idOf(rows[0]) });
  }
  if (!products.length) fail('No suitable products were found in the discovered warehouses. Seed local catalog data and rerun.');
  return products;
}

async function createUsers() {
  const password = crypto.randomBytes(18).toString('base64url');
  const users = [];
  const count = Number(process.env.TEST_USER_COUNT || 5);
  for (let index = 0; index < count; index += 1) {
    const phone = phoneFor(index);
    const { response, data } = await request('POST', `${baseUrl}/auth/register`, {
      name: `Phoenix Load Test ${index + 1}`,
      pharmacyName: `Phoenix Load Pharmacy ${index + 1}`,
      phone,
      address: 'Local load-test fixture',
      password,
      confirmPassword: password,
    });
    if (response.status === 429) fail('Registration was rate-limited. Wait or use a local test environment with suitable limits.');
    if (!response.ok || !data || !data.token) fail(`Registration failed with HTTP ${response.status}. Response did not contain a token; OTP or another registration prerequisite may be enabled.`);
    if (!data.user || data.user.status !== 'active') {
      const generatedUsers = [...users, { phone, password }];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify({ baseUrl, users: generatedUsers, createdAt: new Date().toISOString() }, null, 2));
      fail(`Generated test user ${phone} has status '${data.user && data.user.status}'. Local admin approval is required before protected catalog APIs can be tested.`);
    }
    users.push({ phone, password });
  }
  return users;
}

async function authenticateExisting() {
  let configured = [];
  if (fs.existsSync(outputPath)) {
    try { configured = JSON.parse(fs.readFileSync(outputPath, 'utf8')).users || []; } catch (_) { configured = []; }
  }
  if (!configured.length) {
    const phones = (process.env.TEST_USER_PHONES || process.env.TEST_USER_PHONE || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (!phones.length || !process.env.TEST_USER_PASSWORD) return null;
    configured = phones.map((phone) => ({ phone, password: process.env.TEST_USER_PASSWORD }));
  }
  const users = [];
  for (const user of configured) {
    const { response, data } = await request('POST', `${baseUrl}/auth/login-password`, { phone: user.phone, password: user.password });
    if (!response.ok || !data || !data.token) fail(`Authentication failed for dedicated test user ${user.phone} with HTTP ${response.status}. Personal or production credentials are never attempted.`);
    users.push({ ...user, token: data.token });
  }
  return users;
}

async function main() {
  if (!targetIsLocal() && !allowProtected) fail(`Refusing target ${baseUrl}. Use localhost/staging or explicitly set ALLOW_PROTECTED_TARGET=true after approval.`);
  if (runWrites && (!targetIsLocal() || !allowProtected)) fail('RUN_WRITE_SCENARIOS requires a local target and explicit ALLOW_PROTECTED_TARGET=true.');
  await healthCheck();
  let users = await authenticateExisting();
  if (!users) users = await createUsers();
  const token = users[0].token || (await request('POST', `${baseUrl}/auth/login-password`, users[0])).data.token;
  users = users.map((user) => ({ ...user, token: user.token || token }));
  const warehouseIds = await discoverWarehouses(token);
  const products = await discoverProducts(token, warehouseIds);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ baseUrl, users, warehouseIds, products, createdAt: new Date().toISOString() }, null, 2));
  console.log(`[load-test setup] Ready: ${warehouseIds.length} warehouses, ${users.length} dedicated users, ${products.length} products.`);
  console.log(`[load-test setup] Runtime data written to ${outputPath}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
