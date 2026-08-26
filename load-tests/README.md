# Phoenix k6 Load Tests

Backend API load suite for the Phoenix project. It models up to 2,000 mobile-like virtual users; it does not start Flutter emulators or browsers.

## Requirements

- k6 installed and available on `PATH`
- Node.js 18+ (for the setup orchestrator)
- A local or staging Phoenix backend
- At least five warehouses in the local/test database

## Setup

Set environment variables without committing them:

```powershell
$env:BASE_URL = 'http://localhost:4000/api'
```

Only `BASE_URL` is normally needed. The setup script discovers five warehouses, creates isolated local test users when no runtime users exist, authenticates them, and discovers products. It writes generated credentials only to ignored `load-tests/.runtime/test-data.json`; no credentials are committed. Existing dedicated test credentials may be supplied through `TEST_USER_PHONE(S)` and `TEST_USER_PASSWORD`, but personal or production credentials must not be used.

## Running

Default smoke test (5 VUs for 30 seconds):

```powershell
npm --prefix load-tests run load-test
```

Override smoke VUs and duration:

```powershell
k6 run -e VUS=10 -e DURATION=2m load-tests/main.js
```

Explicitly select the 2,000-VU test with gradual ramp-up:

```powershell
npm --prefix load-tests run load-test:2000
```

The load profile stages are 100, 250, 500, 1,000, 1,500, and 2,000 VUs, followed by a 5-minute hold and ramp-down. Users are assigned round-robin across the five supplied warehouse IDs, approximately 400 users per warehouse at peak. No test is started automatically by this repository.

## Scenario Mix

- 60% browsing: warehouses, categories, products, and one pagination request when a cursor exists
- 20% searching: product search against the real products endpoint
- 10% cart: read-only order-list call; Phoenix has no cart API
- 5% orders: read-only order list and detail
- 5% warehouse: warehouse profile and manufacturers

The k6 setup phase authenticates each dedicated user once through `POST /auth/login-password`; each iteration then calls `GET /auth/me` and the selected read scenarios. This avoids measuring the auth rate limiter instead of application behavior.

## Safety

Do not run this suite against production without explicit approval. The setup refuses non-local targets unless `ALLOW_PROTECTED_TARGET=true` is explicit. The default scenario performs no order writes, sends no OTP, submits no reviews, and uploads no returns. User registration is performed only to create dedicated local fixtures when no existing runtime users are available. `RUN_WRITE_SCENARIOS=true` requires a local target plus explicit `ALLOW_PROTECTED_TARGET=true` and is never enabled by default.

## Metrics and Thresholds

k6 reports request count, requests/sec, average, median, p90, p95, p99, max, HTTP failure rate, checks, and status behavior. Initial non-SLA thresholds are p95 < 1s, p99 < 2s, HTTP failures < 1%, and checks > 99%. Adjust them only after establishing a baseline.

## Results

After a successful run, the orchestrator writes `LOAD_TEST_RESULT.md` and raw data to `load-tests/results/k6-summary.json`. Setup failures identify the exact missing prerequisite, including backend reachability, fewer than five warehouses, pending registration, OTP requirements, authentication failures, or missing products.
