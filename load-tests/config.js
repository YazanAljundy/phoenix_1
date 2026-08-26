import exec from 'k6/execution';

export const baseUrl = (__ENV.BASE_URL || '').replace(/\/$/, '');
export const warehouseIds = [1, 2, 3, 4, 5]
  .map((index) => __ENV[`WAREHOUSE_${index}_ID`])
  .filter(Boolean);
export const testUsers = (() => {
  try { return JSON.parse(__ENV.TEST_USERS_JSON || '[]'); } catch (_) { return []; }
})();
export const testPhones = (__ENV.TEST_USER_PHONES || __ENV.TEST_USER_PHONE || '')
  .split(',').map((value) => value.trim()).filter(Boolean);
export const testPassword = __ENV.TEST_USER_PASSWORD || '';
export const enableMutations = __ENV.RUN_WRITE_SCENARIOS === 'true';
export const pageLimit = Number(__ENV.PAGE_LIMIT || 20);
export const testProfile = __ENV.TEST_PROFILE || 'smoke';
export const vus = Number(__ENV.VUS || 5);
export const duration = __ENV.DURATION || '30s';

export const stages = [
  { duration: '1m', target: 100 },
  { duration: '2m', target: 250 },
  { duration: '2m', target: 500 },
  { duration: '2m', target: 1000 },
  { duration: '2m', target: 1500 },
  { duration: '2m', target: 2000 },
  { duration: '5m', target: 2000 },
  { duration: '1m', target: 0 },
];

export function testOptions() {
  if (testProfile === 'load') return { stages };
  if (testProfile !== 'smoke') {
    throw new Error('TEST_PROFILE must be either smoke or load.');
  }
  if (!Number.isInteger(vus) || vus < 1) throw new Error('VUS must be a positive integer.');
  if (!duration) throw new Error('DURATION must not be empty.');
  return { vus, duration };
}

export function assertConfiguration() {
  if (!baseUrl) throw new Error('BASE_URL is required.');
  if ((!testPhones.length || !testPassword) && !testUsers.length) {
    throw new Error('TEST_USER_PHONE(S) and TEST_USER_PASSWORD are required.');
  }
  if (warehouseIds.length !== 5) throw new Error('Runtime setup did not provide five warehouse IDs.');
  if (enableMutations && __ENV.ALLOW_MUTATIONS_ON_NON_PRODUCTION !== 'true') {
    throw new Error('Explicitly set ALLOW_MUTATIONS_ON_NON_PRODUCTION=true for mutations.');
  }
}

export function vuUser() {
  if (testUsers.length) return testUsers[(exec.vu.idInTest - 1) % testUsers.length];
  return {
    phone: testPhones[(exec.vu.idInTest - 1) % testPhones.length],
    password: testPassword,
  };
}

export function selectedWarehouseId() {
  return warehouseIds[(exec.vu.idInTest - 1) % warehouseIds.length];
}

export function authParams(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

export function responseJson(response) {
  try { return response.json(); } catch (_) { return null; }
}
