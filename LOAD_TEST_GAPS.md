# Phoenix Load Test Gaps

## Cart API

- Area: Cart lifecycle
- Endpoint: None
- Why it cannot be tested: The backend has no cart routes. Cart data is submitted as `items` to `POST /api/orders`.
- Required change: None for this suite; add a cart API only if the product contract introduces one.
- Risk: A cart workflow cannot be measured independently; using orders would create business data.
- Priority: High

## Order Creation

- Area: Create order and checkout
- Endpoint: `POST /api/orders`
- Why it cannot be tested by default: It creates a real order and may trigger downstream notifications or operational workflows.
- Required change: A disposable staging/test database and explicit test-data cleanup policy, not a production-code change.
- Risk: Persistent orders, inventory effects, and external side effects.
- Priority: High

## OTP

- Area: OTP send/login
- Endpoint: `POST /api/auth/otp/send`, `POST /api/auth/login`
- Why it cannot be tested by default: It can invoke the configured SMS provider and requires real-time OTP delivery.
- Required change: A staging SMS sink or test OTP provider configuration; do not modify production code for load testing.
- Risk: Paid SMS, external traffic, and rate limiting.
- Priority: High

## Registration

- Area: User registration
- Endpoint: `POST /api/auth/register`
- Why it cannot be tested by default: It creates users and pharmacy records and consumes unique phone numbers.
- Required change: Dedicated disposable test database and generated test identities.
- Risk: Data growth and duplicate/real-user collisions.
- Priority: Medium

## Reviews and Returns

- Area: Review/return workflows
- Endpoints: `POST /api/reviews`, `POST/PUT/DELETE /api/returns...`
- Why it cannot be tested by default: They create, upload, modify, or delete business records; returns also accept multipart photos.
- Required change: Disposable staging fixtures and cleanup; no production-code change should be made solely for this suite.
- Risk: Irreversible or operationally meaningful records and storage usage.
- Priority: Medium

## Web and Flutter Clients

- Area: Client rendering/performance
- Endpoint: N/A
- Why it cannot be tested here: k6 exercises HTTP APIs, not 2,000 browsers or Flutter emulators.
- Required change: Separate browser and Flutter performance plans.
- Risk: Client-side bottlenecks remain unmeasured by API load tests.
- Priority: Medium
