# Phoenix Load Test Report

## Status

**Load test suite created and ready to run.** k6 was not executed in this environment, so no runtime performance results or breaking point are claimed.

## Test Configuration

- Tool: k6
- Peak virtual users: 2,000
- Ramp: 100 -> 250 -> 500 -> 1,000 -> 1,500 -> 2,000
- Hold: 5 minutes at 2,000 VUs
- Ramp-down: 1 minute
- Warehouses: 5 IDs supplied through `WAREHOUSE_1_ID` through `WAREHOUSE_5_ID`
- Base URL: required through `BASE_URL`; no production URL is hardcoded
- Data: dedicated test credentials and test database/staging only

## Scenarios

The suite includes authenticated browsing, product search/pagination, read-only warehouse details, read-only order history/detail, and a guarded order mutation path. The approximate mix is 60% browsing, 20% search, 10% cart-read proxy, 5% order reads, and 5% warehouse reads.

## Endpoints Included

- `GET /health`
- `POST /auth/login-password`
- `GET /auth/me`
- `GET /warehouses`
- `GET /warehouses/:warehouseId/profile`
- `GET /warehouses/:warehouseId/manufacturers`
- `GET /categories`
- `GET /warehouses/:warehouseId/products`
- `GET /orders`
- `GET /orders/:id`
- Optional, disabled by default: `POST /orders`

All paths are mounted below the configurable `BASE_URL`, normally ending in `/api`.

## Results

| Metric | Result |
|---|---|
| Requests | Not run |
| Requests/sec | Not run |
| Average / median | Not run |
| p90 / p95 / p99 / max | Not run |
| HTTP 4xx / 5xx | Not run |
| Connection/timeout errors | Not run |
| Error rate | Not run |

## Bottlenecks and Breaking Point

Not determined because k6 was not run. After an approved run, inspect per-endpoint tags and correlate latency/error increases with backend and MongoDB monitoring. No database indexes, queries, schemas, or production code were changed.

## Recommendations

- Run first against local or staging with a disposable database.
- Create enough active pharmacy test accounts to avoid auth rate-limit distortion.
- Monitor Node.js, MongoDB query latency, connection pools, CPU, memory, and rate-limit responses during the run.
- Establish a baseline with the smoke command before the 2,000-VU profile.
- Run write scenarios separately after data cleanup and explicit approval.
