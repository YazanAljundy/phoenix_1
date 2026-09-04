# Phoenix Load Test — Coverage Gaps

What this suite could not measure, and why. Everything else is in
[`../LOAD_TEST_REPORT.md`](../LOAD_TEST_REPORT.md).

Nothing listed here was worked around by changing production code.

---

## 1. Cart lifecycle

- **Area:** add to cart, change quantity, remove item
- **Endpoint:** none exists
- **Why:** Phoenix has no cart API. `lib/features/cart` holds the basket in
  client state and submits it as `items` on `POST /orders`, so those three
  actions generate no server traffic at all. There is nothing to load-test.
- **What was tested instead:** the traffic a shopping session actually
  produces — repeated catalog reads while the basket is assembled, then one
  `POST /orders` (scenario C).
- **Change required:** none, unless a server-side cart is ever introduced.
- **Priority:** informational

## 2. In-app notification list

- **Area:** reading notifications
- **Endpoint:** none exists
- **Why:** `Notification` documents are written on every order status change
  and every admin broadcast, and `notification.model.js` even carries a
  `{ userId, isRead }` index for a list query — but no route exposes them and
  the Flutter `Endpoints` class has no entry for one. The data is write-only.
- **What was tested instead:** the write/fan-out path through
  `POST /api/admin/notifications` (scenario G), plus its collateral effect on
  concurrent requests.
- **Change required:** a read endpoint would be a product decision, not a load-
  test change.
- **Priority:** worth raising with the product owner — the index suggests the
  read was intended.

## 3. FCM push delivery

- **Area:** actual push delivery to devices
- **Endpoint:** Firebase, not Phoenix
- **Why:** `notification.service.js` only calls FCM for users with registered
  device tokens. Delivery latency and throughput past that call belong to
  Firebase and cannot be attributed to this backend. The notification test
  additionally **refuses to run** if any user has a device token, so a load
  test can never push to a real device.
- **What was tested instead:** everything up to the FCM call — recipient
  selection, per-recipient `User.findById`, and `Notification.create`.
- **Change required:** a separate device/integration test against a test
  Firebase project.
- **Priority:** medium

## 4. OTP send and OTP login

- **Area:** `POST /auth/otp/send`, `POST /auth/login`
- **Why:** `SMS_PROVIDER` can be pointed at a paid provider, and OTP login
  needs a code delivered out of band. Load-testing it risks real SMS spend and
  cannot complete without a receiving channel.
- **Note:** both routes are currently unreachable from the app anyway —
  `auth.service.js` documents that OTP verification is disabled and every
  client uses `POST /auth/login-password`.
- **What was tested instead:** `POST /auth/login-password`, the only login path
  in use, measured to its bcrypt-bound ceiling.
- **Change required:** an SMS sink or test provider in a staging environment.
- **Priority:** low while OTP stays disabled

## 5. Registration at load

- **Area:** `POST /auth/register`
- **Why:** it permanently consumes phone numbers from a validated Syrian
  format (`^(?:\+963|0)9\d{8}$`) and creates a User plus a Pharmacy per call.
  Running it at load would burn a real identifier space and leave thousands of
  pending accounts in the admin approval queue.
- **What was tested instead:** fixtures are seeded directly into MongoDB, so
  registration is exercised exactly once per account and never under load. The
  cost it *would* carry is known from `login-password`: both hash with bcrypt
  at cost 10, which is the dominant term.
- **Change required:** a disposable database and a reserved phone-number range.
- **Priority:** medium

## 6. Return creation at high concurrency

- **Area:** `POST /returns`, `PUT /returns/:id`
- **Why:** every return requires at least one photo, and the controller streams
  each photo to Cloudinary *before* validating the return. At sweep
  concurrency this stops being a test of Phoenix and becomes a stress test of a
  third party, spending real quota on the project's own Cloudinary account.
- **What was tested instead:** the return **read** paths at full sweep
  concurrency, and the upload path separately at 1/4/8 concurrency with small
  images, deleting every return it created afterwards
  (`DELETE /returns/:id` is also what removes the Cloudinary assets).
- **Change required:** a dedicated Cloudinary test account, or a local
  storage stub configured through env for staging only.
- **Priority:** medium

## 7. Warehouse and admin panel breadth

- **Area:** most of `/warehouse/*` and `/admin/*`
- **Why:** the sweep models the pharmacist population, which is the large one.
  The panels are used by a handful of operators, so loading them at the same
  scale would not represent anything real.
- **What was tested instead:** `GET /warehouse/orders` inside the mix, the
  admin broadcast endpoint in scenario G, and — importantly — the Socket.IO
  layer, which **only** warehouse and admin users can connect to.
- **Change required:** none; a separate small-scale panel profile would be more
  representative than folding it into this sweep.
- **Priority:** low

## 8. Excel catalog import

- **Area:** `POST /warehouse/catalog/import` and the admin equivalent
- **Why:** ExcelJS parsing of a 5 MB workbook is a synchronous, event-loop-
  blocking operation on a single-threaded server, so testing it under
  concurrent load would mostly re-measure the blocking already characterised in
  the report's bottleneck section — while writing large volumes of catalog data
  that is far harder to reverse than an order.
- **What was tested instead:** nothing directly. Flagged as a risk: the same
  event-loop blocking that makes large catalog reads expensive applies here
  with a much larger constant.
- **Change required:** a disposable database and a decision on acceptable
  import duration.
- **Priority:** high as a *risk*, low as a test gap

## 9. Client-side performance (Flutter and the React panel)

- **Area:** rendering, scroll performance, memory on device
- **Why:** k6 drives HTTP; it does not run 2,000 Flutter engines or browsers.
- **Note:** one client-side fact was established from the code and does matter
  to the server numbers: `api_client.dart` sets 15-second connect and receive
  timeouts, so the load suite uses the same 15 s timeout — a request the real
  app would abandon is counted as a timeout here too.
- **Change required:** separate Flutter integration/profiling runs and a
  browser performance plan.
- **Priority:** medium

## 10. Production environment

- **Area:** the deployed backend at `phoenix-1-p2qi.onrender.com`
- **Why:** not tested, by design. See the report's "Testing production" section
  for what would need to be configured first, what the risks are, and what
  limits should apply.
- **Priority:** n/a
