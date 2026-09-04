# Phoenix Load & Stress Test Suite

Full-system load testing for the Phoenix backend: HTTP APIs, Socket.IO realtime,
return-photo uploads, and catalog-size scaling. Nothing here modifies
application code — the backend is exercised only through its public API, plus
one out-of-band instrumentation module loaded with `node -r`.

The measured results live in [`../LOAD_TEST_REPORT.md`](../LOAD_TEST_REPORT.md).

## Layout

```
lib/runtime.js          k6 helpers: fixtures, tokens, tagging, client-IP simulation
lib/monitor.js          out-of-band sampler (backend probe + MongoDB + machine + processes)
instrument/probe.js     preloaded into the backend: event-loop lag, pool events, CPU profile
instrument/start-backend.sh   starts the backend with the probe attached
scenarios/*.js          one module per user journey (auth, browsing, cart, orders, returns, reviews, warehouse)
main.js                 k6 entry: one load level, ramp -> steady -> ramp down
run-progressive.js      Phase 4/5 driver: level sweep, grading, system metrics
socket-load.js          Socket.IO: connection capacity, event fan-out, reconnection storm
upload-load.js          return-photo (Cloudinary) upload stress, deliberately small
catalog-scaling.js      per-endpoint latency vs catalog size, at concurrency 1
setup/seed-load-data.js fixture seeder / cleaner
setup/mint-tokens.js    logs every fixture account in once; also measures login throughput
setup/verify-endpoints.js  single-request correctness + baseline latency for every endpoint
build-report-data.js    renders the report's tables straight from results/
```

## Requirements

- k6 on `PATH`
- Node.js 18+
- A local backend and a local MongoDB
- The backend started through `instrument/start-backend.sh` if you want
  event-loop, connection-pool and CPU-profile data

## Running

```bash
# 1. Start the backend with instrumentation (port 5000, probe on 9999)
bash load-tests/instrument/start-backend.sh

# 2. Seed isolated fixtures (500 pharmacies, 3 catalogs, 25 socket warehouses,
#    6,000 delivered orders). Refuses any non-local MongoDB host.
node load-tests/setup/seed-load-data.js

# 3. Mint one JWT per fixture account
node load-tests/setup/mint-tokens.js

# 4. Confirm every endpoint answers correctly before applying load
node load-tests/setup/verify-endpoints.js

# 5. Progressive sweep
node load-tests/run-progressive.js --tag main

# 6. The separate measurements
node load-tests/catalog-scaling.js
node load-tests/socket-load.js
node load-tests/upload-load.js

# 7. Remove every fixture and everything the write scenarios created
node load-tests/setup/seed-load-data.js --clean
```

`npm --prefix load-tests run load-test` runs a short smoke level;
`npm --prefix load-tests run load-test:full` runs the whole sweep.

## Test data

Every fixture document carries `loadTestTag: 'phoenix-load-test'`, and every
fixture account's phone starts with `0977`. Records the *write* scenarios
create through the API (orders, reviews, returns) cannot carry that tag — the
application does not know about it — so `--clean` also deletes by ownership:
anything belonging to a tagged pharmacy or tagged warehouse. Nothing outside
those two sets is ever touched.

The seeder refuses to run against a non-local MongoDB host unless
`ALLOW_PROTECTED_TARGET=true` is set explicitly.

## Client-IP simulation

`app.js` sets `trust proxy: 1`, so `express-rate-limit` keys its buckets on
`X-Forwarded-For` rather than on the socket address. A load generator arrives
from one address; two thousand real users do not. Every request the suite sends
therefore carries a distinct simulated client IP, from a bounded pool
(`IP_POOL`, default 60,000 — bounded because `express-rate-limit`'s MemoryStore
holds one entry per key for a full window).

Without this, the only thing measurable is the limiter: at 300 requests per 15
minutes per IP, a single-IP client is throttled after 300 requests no matter
how fast the application is. `--no-ip-simulation` runs exactly that as a
control, and both results are reported.

## Thresholds

`thresholds.js` keeps the project's existing values — p95 < 1 s, p99 < 2 s,
HTTP failures < 1 % — and adds the grading bands `run-progressive.js` uses to
label each level PASS / DEGRADED / FAIL. Thresholds do not abort a level: a
level has to be allowed to fail for the breaking point to be found.

## Scenario mix

Weighted per iteration, derived from `(vu id * 17 + iteration * 31) % 100` so
every level exercises the same distribution:

| Share | Scenario | Journey |
| ---: | :--- | :--- |
| 40 % | B browsing | banners, exchange rate, warehouses, profile, manufacturers, categories, products, page 2 |
| 15 % | B search | product search |
| 7 % | B manufacturer filter | products filtered by manufacturer |
| 15 % | D order history | order list + one detail + returnable orders |
| 5 % | D order detail | detail read directly, isolated from the list |
| 8 % | C shopping | three catalog pages, then `POST /orders` |
| 4 % | E returns | returnable orders + return list |
| 3 % | F reviews | read reviews, submit a rating, re-read |
| 2 % | A authentication | full `POST /auth/login-password` + `/auth/me` + warehouse selection |
| 1 % | warehouse panel | pharmacist warehouse detail + `GET /warehouse/orders` |

`GET /auth/me` runs on every iteration, matching the Flutter app's launch and
resume behaviour. Think time is 1–3 s, so a VU models a person rather than a
closed-loop hammer.

## Safety

- Local targets only unless `ALLOW_PROTECTED_TARGET=true` is set explicitly.
- No test starts automatically; every one is an explicit command.
- The upload scenario is deliberately capped at a few dozen small images: it
  spends real quota on a third-party Cloudinary account, and it deletes every
  return it creates afterwards (which is also what removes the uploaded assets).
- OTP/SMS is never exercised: `POST /auth/otp/send` can call a paid provider.
- Registration is never load-tested; fixtures are seeded directly instead, so
  no phone-number space is consumed.
