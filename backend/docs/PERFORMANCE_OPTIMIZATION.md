# Phoenix Backend — Performance Optimization Reference

Central reference for incremental backend performance work. **Read this file
first** before starting a new optimization task; only open source files when
this document is not enough.

Scope of the current effort: reduce wasted work on read-heavy paths without
changing API contracts, schemas, or indexes.

---

## 1. Architecture relevant to database queries

Stack: Node.js / Express + Mongoose 8 + MongoDB. Flutter app (pharmacy) and a
React panel (warehouse + admin) are the clients.

Request flow for a read:

```
route (src/routes/*.routes.js)
  -> middleware (auth.middleware.js: authenticate -> req.user)
  -> controller (src/controllers/*.controller.js)   validates input
  -> service   (src/services/*.service.js)          all Mongoose queries live here
  -> viewmodel (src/viewmodels/*.viewmodel.js)      shapes the JSON response
  -> res.json({ success: true, ... })
```

Rules that make projection/lean safe to reason about:

- **All DB access is in services.** Controllers never query; viewmodels never
  query. So the consumer of any query result is either (a) another line in the
  same service, or (b) exactly one viewmodel function.
- **Viewmodels are explicit allow-lists.** Each `serializeX` names the exact
  fields that leave the API. If a field is not read by the viewmodel and not
  used in service logic, it does not need to be fetched.
- **Writes are separate.** Mutating paths load their own document (e.g.
  `admin.service.js` `findPendingUserOrThrow`, `order.service.js` `cancelOrder`).
  Read paths that feed a viewmodel never `.save()`.

### `.lean()` status (prerequisite pass, mostly already in the working tree)

A `.lean()` pass has been applied to most read-only service queries
(`warehouse`, `category`, `banner`, `order` list paths, `exchangeRate`,
`warehouseReview`, `product` search, `admin.broadcastNotification`, `auth`).
`.lean()` returns raw BSON and **does not apply schema defaults** — the risk is
a field added to a schema after some documents existed silently dropping from
the response. That risk is pinned by `test/readpath.lean.test.js`
(`warehouses.minOrderAmountUsd/maxOrderAmountUsd` is the known case; the
viewmodel now applies `?? default`).

Level 1 (this document's main subject) is the **`.select()` projection** pass
layered on top. It does **not** add `.lean()` broadly — only `.select()`, and
only where every consumed field is proven.

---

## 2. Main collections / models

| Model | Collection | Notes for read paths |
|---|---|---|
| `User` | `users` | `password` is `select: false`. `deviceTokens` is an **unbounded array** (one entry per device, grows on every new install). `phone` unique. |
| `Pharmacy` | `pharmacies` | 1:1 with a `User` (`userId`). Has reserved/unused fields (`licenseNumber`, `licenseImage`), rating counters, and a GeoJSON `location` subdoc. |
| `Warehouse` | `warehouses` | 1:1 with a `User` (`userId`). Many operational fields (rates, delivery windows, order limits) not needed by every endpoint. |
| `Product` | `products` | Per-warehouse catalog rows; can link to a `ProductCatalog` master via `masterProductId`. Largest collection. |
| `ProductCatalog` | `productcatalogs` | Shared master product identity. |
| `Order` / `OrderItem` | `orders` / `orderitems` | `OrderItem` is the unbounded set per order. `Order.statusHistory` is an array. |
| `Return`, `Review`, `Offer`, `Banner`, `Category`, `ExchangeRate`, `Notification`, `Payment`, `PharmacyBalance`, `Complaint`, `ManufacturerDiscount`, `WarehouseManufacturer`, `Otp`, `Counter` | — | See model files as needed. |

---

## 3. Important read queries (high frequency first)

All of the rows below are now `.select()`-projected (see the Level 1 table).

| Query | Service | Endpoint(s) | Feeds |
|---|---|---|---|
| `User.findById(sub).select('_id role status').lean()` | `auth.middleware.js` | **every authenticated request + every socket handshake** | `req.user` (reads `_id`, `role`, `status` only) |
| `User.findById(userId).select(AUTH_USER_FIELDS).lean()` | `auth.service.getMe` | `GET /auth/me` (Flutter: every launch/resume) | `auth.viewmodel.serializeUser` + `loadProfile` |
| `User.findOne({ phone }).select('+password …')` | `auth.service.loginWithPassword` | `POST /auth/login-password` (all 3 roles) | password compare, then `serializeUser` |
| `Pharmacy.findOne({ userId }).select(…)` / `Warehouse.findOne({ userId }).select(…)` | `auth.service.loadProfile` | every auth response | `auth.viewmodel.serializePharmacy` / `serializeWarehouse` |
| `Warehouse.find({ userId: {$in}, isActive }).select(…).lean()` | `warehouse.service.listAvailableWarehouses` | `GET /warehouses` | `warehouse.viewmodel` |
| `Warehouse.findOne({ _id, isActive }).select('userId').lean()` | `warehouse.service.isWarehouseAvailable` | catalog / profile / order requests | existence check only |
| `Product.find(filter).select(CATALOG_PRODUCT_SELECT).populate({select}).lean()` | `product.service` | `GET /warehouse/catalog` browsing | `product.viewmodel` |
| `Category.find().select(…).sort().lean()` | `category.service` | `GET /categories` | `category.viewmodel` |
| `Banner.find({...}).select(…).lean()` | `banner.service` | `GET /banners` | `banner.viewmodel` |
| `Order.find(filter).select(…).sort().limit().lean()` | `order.service.listOrdersForPharmacy` | `GET /orders` | `order.viewmodel` |
| `User.find({status,role}).select(…)` (+ pharmacies/warehouses) | `admin.service.listPendingAccounts` / `…Paginated` | `GET /admin/pending-accounts` | `admin.viewmodel` (reuses `auth.viewmodel` serializers) |

---

## 4. Current indexes

> **Level 2 changed the indexes on `orders`, `reviews`, `users`,
> `pharmacybalances`, `returns` and `products`.** The list below is the
> pre-Level-2 baseline; see **Level 2 — MongoDB Query & Index Optimization →
> Final index list** for the current state of those six collections. All
> others are unchanged.

- `users`: `phone` unique.
- `pharmacies`: `{userId:1}`, `{city:1}`, `{location:'2dsphere'}`.
- `warehouses`: `{userId:1}`, `{city:1}`.
- `products`: `{warehouseId:1, categoryId:1}`, text index on `nameAr/nameEn/manufacturerAr/manufacturerEn`, unique partial on `masterProductId`.
- `productcatalogs`: `{nameAr:1, manufacturerAr:1}` unique.
- `orders`: `orderNumber` unique, `{pharmacyId:1}`, `{warehouseId:1}`, `{status:1}`.
- `orderitems`: `{orderId:1}`, `{productId:1}`.
- `returns`: `orderId` unique, `{warehouseId:1,status:1}`, `{pharmacyId:1}`.
- `reviews`: `{orderId:1, reviewerType:1}` unique.
- `offers`: `{productId:1}`, `{warehouseId:1, status:1}`.
- `banners`: `{status:1,startDate:1,endDate:1}`, `bannerNumber` unique.
- `notifications`: `{userId:1,isRead:1}`, `{userId:1,createdAt:-1}`.
- `payments`: `{pharmacyId:1, warehouseId:1}`.
- `pharmacybalances`: `{pharmacyId:1, warehouseId:1}` unique.
- `manufacturerdiscounts`, `warehousemanufacturers`: `{warehouseId:1, manufacturerAr:1}` unique.
- `otps`: `{phone:1, expiresAt:1}`, TTL on `expiresAt`.
- `complaints`: `complaintNumber` unique, `{pharmacyId:1,createdAt:-1}`, `{warehouseId:1,createdAt:-1}`, `{status:1,createdAt:-1}`.

---

## 5. Endpoint → model map (read side, condensed)

- **auth** (`/auth/*`): `User`, `Pharmacy`, `Warehouse`.
- **warehouses list/profile** (`/warehouses`): `Warehouse`, `User`, `Review`, `Pharmacy`.
- **catalog/browsing** (`/warehouse/catalog`, `/categories`, `/banners`): `Product`, `ProductCatalog`, `Offer`, `ManufacturerDiscount`, `Category`, `Banner`, `Warehouse`.
- **orders** (`/orders`): `Order`, `OrderItem`, `Warehouse`, `Return`, `Review`, `ExchangeRate`.
- **returns / reviews**: `Return`, `Review`, `Order`, `OrderItem`, `Pharmacy`, `Warehouse`.
- **admin** (`/admin/*`): `User`, `Pharmacy`, `Warehouse`, plus per-feature models.
- **notifications fan-out**: `User` (`_id` + `deviceTokens`), `Notification`.

---

## 6. Important findings

1. **The auth response objects are small allow-lists, but the queries behind
   them fetched whole documents.** `serializeUser` needs 6 fields;
   `serializePharmacy` needs 8; `serializeWarehouse` (auth) needs 6. The
   documents carry ~10 / ~19 / ~22 fields respectively.
2. **`users.deviceTokens` is the single worst offender on the auth path.** It
   is an unbounded array, it is never read on any auth path, and it was being
   deserialised on every `GET /auth/me` and every login. (It is loaded
   deliberately and separately by `notification.service.js`, which is the only
   place that needs it.)
3. The `auth.middleware.js` hot query was **already** narrowed to
   `.select('_id role status').lean()` in a previous change — that is the
   correct pattern and the model for this work.
4. Pharmacy `location` (GeoJSON subdoc) and the reserved licence fields are
   pure weight on `GET /auth/me` for every pharmacist.

---

## 7. Changes made

Level 1 has now been applied **across the whole backend** — see the
**Level 1 — MongoDB Projection** section below for the full change table,
the deferred list, verification, and measurements.

Summary of files touched by the `.select()` pass:

`auth.service.js` (initial), `banner.service.js`, `category.service.js`,
`warehouse.service.js`, `warehouseReview.service.js`, `review.service.js`,
`admin.service.js`, `order.service.js`, `warehouseOrder.service.js`,
`return.service.js`, `warehouseReturn.service.js`,
`manufacturerDiscount.service.js`, `warehouseManufacturer.service.js`,
`warehouseOffer.service.js`, `adminOffer.service.js`,
`adminProduct.service.js`, `adminBanner.service.js`,
`warehouseBanner.service.js`, `warehouseProduct.service.js`,
`product.service.js`, `pharmacyBalance.service.js`.

No controller, viewmodel, schema, index, or API response shape was changed.
(`auth.viewmodel.js`'s `?? default` and `warehouse.viewmodel.js`'s were added
by the earlier `.lean()` pass, not this one.)

## 8. Changes intentionally NOT made

- **No index changes, no schema changes, no API shape changes, no pagination
  or sorting changes, no compression, no Flutter/React changes.**
- **`.lean()` was not broadly added.** Level 1 is `.select()` only. A handful
  of `.select('_id')` existence checks and name-only joins were added without
  `.lean()` where the query was already hydrated and not saved.
- **Write paths.** Every `findOne(...)`/`findById(...)` whose result is later
  `.save()`d is left untouched: `admin.findPendingUserOrThrow`,
  `order.getOrderForPharmacy`'s own `Order` doc (feeds `cancelOrder`),
  `warehouseOrder.advanceOrderStatus`/`updateOrderItems`'s `Order` +
  `currentItems`, `return.loadOwnPendingReturnOrThrow`,
  `warehouseReturn.loadPendingReturnOrThrow`, `*.findOwned*OrThrow` for
  discounts/payments/products/banners, `warehouseSettings.getSettings`
  (shared with `updateOrderLimits`), `otp.verifyOtp`,
  `productCatalog.findCatalogItemOrThrow`.
- **`order.service.js createOrder` pricing reads** (`Warehouse.findById`,
  `Product.find(...).populate`, `Offer.find`) and **`warehouseOrder.js
  updateOrderItems` add-item pricing reads** — many fields feed the SYP/USD
  pricing calculation, order-creation is low frequency, and a missed field
  would mis-price an order. **Deferred — requires dedicated verification.**
- **`adminProduct` / `warehouseProduct` list — the `Product` document
  itself.** `adminProduct.viewmodel` / `warehouseProduct.viewmodel` read
  almost the whole product doc (`description`, `manuallyDisabled`,
  `lastPriceUpdate`, the `priceHistory` array, …). Only the `.populate()`
  select was applied there; a full product projection is low-value.
- **`productCatalog.service.js` `listCatalog` / `searchActiveForWarehouse`** —
  `productCatalog.viewmodel.serializeCatalogItem` emits every stored field.
  **Not applicable.**
- **`exchangeRate.service.js` `getRate`** — all four fields (`usdToSyp`,
  `source`, `lastUpdated`, `manualOverride`) are used by order pricing, the
  refresh scheduler, or `exchangeRate.viewmodel`. **Not applicable.**
- **`complaint*` / `notification.service.js`** — already fully `.select()`d by
  a previous change; re-verified, not re-touched.
- **`PharmacyBalance` / `Payment` documents** — small docs whose viewmodels
  read nearly every field; not worth a projection.

## 9. Future optimization opportunities (not started)

- The two deferred pricing-calculation read sets (`createOrder`,
  `updateOrderItems`).
- A full `Product` projection for the admin/warehouse product-management
  lists (needs the `priceHistory` array handled, likely a separate slice).
- The Level 2 "Deferred" items (dedicated `{pharmacyId,warehouseId,status}`
  order index; `offers` status index; `complaints` `_id`-vs-`createdAt`
  pagination mismatch).
- Response compression, an N+1 sweep on the admin dashboards, a covering-index
  pass (several list queries still FETCH after the IXSCAN).

*(Level 1 — projection — and Level 2 — query/index — are complete. See their
sections below.)*

---

## Level 1 — MongoDB Projection

`.select()` projections added to read queries across the backend so a query
returns only the fields its consumer (a viewmodel serializer, or in-service
logic) actually reads. Traced per query: **MongoDB → service → controller →
viewmodel → response**. No API response changed shape.

### Completed — all `.select()` projections added

`_id` is always returned unless explicitly excluded, so it is never listed.
"Join key" = the id used to build a `Map` for an in-memory join in the service.

| Model | Service · function | Query | Selected | Excluded (highlights) | Endpoint | Why safe |
|---|---|---|---|---|---|---|
| User | `auth.getMe` | `findById` | `name phone role status lang` | `deviceTokens`, timestamps | `GET /auth/me` | = `serializeUser`; `loadProfile` only needs `role`/`_id` |
| User | `auth.loginWithPassword` | `findOne({phone})` | `+password name phone role status lang` | `deviceTokens`, timestamps | `POST /auth/login-password` | above + `bcrypt.compare(password)` |
| User | `auth.registerOrLogin` / `auth.login` | `findOne({phone})` | `name phone role status lang` | `deviceTokens`, timestamps | `POST /auth/register` | = `serializeUser`; not saved |
| Pharmacy | `auth.loadProfile` | `findOne({userId})` | `nameAr nameEn ownerName address city phone verificationPhoto` | `userId`, licence fields, rating counters, `isActive`, `location`, timestamps | auth responses | = `auth.serializePharmacy` |
| Warehouse | `auth.loadProfile` | `findOne({userId})` | `nameAr nameEn city phone logo` | rates, delivery windows, counters, `isActive`, timestamps | auth responses | = `auth.serializeWarehouse` |
| Banner | `banner.listActiveBanners` | `find({status,dates})` | `imageUrl productId manufacturerAr warehouseId` | `title`, `bannerNumber`, `status`, dates, `rejectionNote`, `approvedBy`, `createdBy`, timestamps | `GET /banners` | = `serializeActiveBanner` (5 keys) |
| Category | `category.listCategories` | `find()` | `nameAr nameEn icon sortOrder` | timestamps | `GET /categories` | = `serializeCategory` |
| Warehouse | `warehouse.listAvailableWarehouses` | `find({userId:{$in},isActive})` | `nameAr nameEn city phone logo minOrderAmountUsd maxOrderAmountUsd` | `userId`, `address`, rates, delivery windows, counters, `deliveryType`, `isActive`, timestamps | `GET /warehouses` | = `warehouse.viewmodel.serializeWarehouse` (card); pinned by `readpath.lean.test.js` |
| Warehouse | `warehouse.getWarehouseProfile` | `findById` | `nameAr nameEn address city phone logo deliveryStartTime deliveryEndTime deliveryType minOrderAmountUsd maxOrderAmountUsd` | `userId`, `discountRate`, `commissionRate`, `inventoryUpdateTime`, counters, `isActive`, timestamps | `GET /warehouses/:id` | = `toWarehouseProfileResponse`; rating computed live from `reviews` |
| Review | `warehouseReview.listReviewsForWarehouse` | `find({warehouseId,reviewerType,isVisible})` | `rating comment createdAt reviewerType orderId pharmacyId` | `warehouseId`, `isVisible`, `updatedAt` | `GET /warehouses/:id` (recentReviews) | = `warehouse.viewmodel.serializeReview` + join keys |
| Pharmacy | `warehouseReview.listReviewsForWarehouse` (join) | `find({_id:{$in}})` | `ownerName` | everything else | same | only `resolveReviewerName` reads `ownerName` |
| Review | `warehouseReview.listPaginatedReviewsForWarehouse` | `find(filter)` | `orderId pharmacyId rating comment createdAt reviewerType` | `warehouseId`, `isVisible`, `updatedAt` | `GET /warehouse/reviews` | = `warehouseReview.viewmodel.serializeReceivedReview` + join keys |
| Pharmacy | `warehouseReview.listPaginated…` (join) | `find({_id:{$in}})` | `nameAr nameEn ownerName` | rest | same | names + `resolveReviewerName` |
| Order | `warehouseReview.createPharmacyReview` | `findOne({_id,warehouseId})` | `status pharmacyId` | rest | `POST /warehouse/reviews` | not saved; only status guard + `pharmacyId` |
| Review | `warehouseReview.createPharmacyReview` (dup check) | `findOne(...)` | `_id` | all | same | `Boolean(existing)` only |
| Review | `review.listReviewsForPharmacy` | `find({pharmacyId,reviewerType})` | `orderId warehouseId rating comment createdAt reviewerType` | `pharmacyId`, `isVisible`, `updatedAt` | `GET /reviews` | = `review.viewmodel.serializeReceivedReview` + join keys |
| Warehouse | `review.listReviewsForPharmacy` (join) | `find({_id:{$in}})` | `nameAr nameEn` | rest | same | names + `resolveReviewerName` (`nameAr`) |
| Order | `review.createWarehouseReview` | `findOne({_id,pharmacyId})` | `status warehouseId` | rest | `POST /reviews` | not saved |
| Review | `review.createWarehouseReview` (dup check) | `findOne(...)` | `_id` | all | same | `Boolean(existing)` |
| User | `admin.listPendingAccounts` / `…Paginated` | `find({status,role})` | `name phone role status lang` | `deviceTokens`, timestamps | `GET /admin/pending-accounts` | = `serializeUser` (via `admin.viewmodel`); approve/reject re-load their own doc |
| Pharmacy | `admin.listPendingAccounts` / `…Paginated` (join) | `find({userId:{$in}})` | `userId nameAr nameEn ownerName address city phone verificationPhoto` | licence fields, counters, `isActive`, `location`, timestamps | same | = `serializePharmacy` + join key |
| Warehouse | `admin.listPendingAccounts` / `…Paginated` (join) | `find({userId:{$in}})` | `userId nameAr nameEn city phone logo` | rest | same | = `serializeWarehouse` + join key |
| User | `admin.createWarehouseAccount` (dup check) | `findOne({phone})` | `_id` | all | `POST /admin/warehouse-accounts` | `Boolean(existing)` |
| Order | `order.listReturnableOrders` (candidates) | `find({pharmacyId,status,updatedAt})` | `orderNumber warehouseId finalPrice statusHistory` | pricing fields, `notes`, `cancel*`, timestamps | `GET /orders/returnable` | `findDeliveredAt` walks `statusHistory`; `serializeReturnableOrder` reads `orderNumber`/`warehouseId`/`finalPrice` |
| OrderItem | `order.listReturnableOrders` (items) | `find({orderId:{$in}})` | `orderId productId productNameAr productNameEn quantity discountPrice` | `manufacturer*`, `unitPrice`, `savingsUsd`, timestamps | same | = returnable item shape |
| Warehouse | `order.listReturnableOrders` (join) | `find({_id:{$in}})` | `nameAr nameEn` | rest | same | names only |
| Warehouse | `order.getOrderForPharmacy` | `findById` | `nameAr nameEn` | rest | `GET /orders/:id` | = `toOrderDetailResponse` |
| OrderItem | `order.getOrderForPharmacy` | `find({orderId})` | `productId productNameAr productNameEn manufacturerAr manufacturerEn quantity unitPrice discountPrice savingsUsd` | `orderId`, timestamps | same | = detail item shape (+ `lineTotal` from `discountPrice`×`quantity`) |
| Return | `order.getOrderForPharmacy` | `findOne({orderId})` | `status rejectionNote replacementOrderId` | `items[]`, `images[]`, `notes`, ids, `resolvedAt`, timestamps | same | = `serializeLinkedReturn` |
| Review | `order.getOrderForPharmacy` | `findOne({orderId,reviewerType})` | `rating comment createdAt` | rest | same | = `serializeMyReview` |
| Order | `order.listOrdersForPharmacy` | `find(filter)` | `orderNumber status totalPrice discountAmount commissionAmount finalPrice createdAt warehouseId` | `notes`, `cancel*`, `statusHistory`, `pharmacyId`, `updatedAt` | `GET /orders` | = `toOrderListItemSummary`; list row carries no items/history |
| Warehouse | `order.listOrdersForPharmacy` (join) | `find({_id:{$in}})` | `nameAr nameEn` | rest | same | names only |
| Order | `warehouseOrder.listOrdersForWarehouse` | `find(filter)` | `orderNumber status finalPrice notes createdAt pharmacyId` | other pricing, `cancel*`, `statusHistory`, `warehouseId`, `updatedAt` | `GET /warehouse/orders` | = `toWarehouseOrderItem` (list row) |
| OrderItem | `warehouseOrder.listOrdersForWarehouse` | `find({orderId:{$in}})` | `orderId productId productNameAr productNameEn manufacturerAr manufacturerEn quantity unitPrice discountPrice` | `savingsUsd`, timestamps | same | = `serializeOrderItem` (list) |
| Pharmacy | `warehouseOrder.listOrdersForWarehouse` (join) | `find({_id:{$in}})` | `nameAr nameEn ownerName address city phone verificationPhoto` | rest | same | = `auth.serializePharmacy` |
| Order | `warehouseOrder.getOrderDetailForWarehouse` | `findOne({_id,warehouseId})` | `orderNumber status totalPrice discountAmount commissionAmount finalPrice notes cancelReason createdAt statusHistory pharmacyId` | `cancelledBy`, `warehouseId`, `updatedAt` | `GET /warehouse/orders/:id` | read-only detail (no status change); = `toWarehouseOrderDetailResponse` |
| OrderItem | `warehouseOrder.getOrderDetailForWarehouse` | `find({orderId})` | …as list + `savingsUsd` | `orderId`, timestamps | same | detail item shape |
| Pharmacy | `warehouseOrder.getOrderDetailForWarehouse` | `findById` | `nameAr nameEn ownerName address city phone verificationPhoto` | rest | same | = `serializePharmacy` |
| Return | `warehouseOrder.getOrderDetailForWarehouse` | `findOne({orderId})` | `_id` | all | same | `Boolean(returnRequest)` |
| Pharmacy | `warehouseOrder.updateOrderItems` (response) | `findById` ×2 | `userId nameAr nameEn ownerName address city phone verificationPhoto` | rest | `PATCH /warehouse/orders/:id/items` | not saved; `userId` for the pharmacist notification |
| Return | `warehouseOrder.updateOrderItems` (response) | `findOne({orderId})` ×2 | `_id` | all | same | `Boolean(returnRequest)` |
| OrderItem | `return.loadOrderItemsMap` | `find({orderId})` | `productId quantity productNameAr productNameEn` | `manufacturer*`, `unitPrice`, `discountPrice`, `savingsUsd`, `orderId`, timestamps | create/update return | `validateItems` reads `_id`/`productId`/`quantity`; viewmodel reads the two names |
| Order | `return.createReturn` | `findOne({_id,pharmacyId})` | `status statusHistory warehouseId orderNumber` | rest | `POST /returns` | not saved; delivered-guard + window + emit + new Return inherits `warehouseId` |
| Return | `return.createReturn` (dup check) | `findOne({orderId})` | `_id` | all | same | `Boolean(existing)` |
| Return | `return.listReturnsForPharmacy` | `find(filter)` | `orderId items notes images status rejectionNote replacementOrderId resolvedAt createdAt` | `pharmacyId`, `warehouseId`, `resolvedBy`, `updatedAt` | `GET /returns` | = `serializeReturn` + `attachOrderContext` |
| OrderItem | `return.attachOrderContext` | `find({_id:{$in}})` | `productNameAr productNameEn` | everything else | `GET /returns`, `GET /warehouse/returns` | = `serializeReturnItem` |
| Pharmacy | `warehouseReturn.attachContextAndPharmacy` | `find({_id:{$in}})` | `nameAr nameEn phone` | rest | `GET /warehouse/returns` | = `serializeWarehouseReturn` |
| Return | `warehouseReturn.listReturnsForWarehouse` / `…Paginated` | `find(filter)` | `orderId pharmacyId items notes images status rejectionNote replacementOrderId resolvedAt createdAt` | `warehouseId`, `resolvedBy`, `updatedAt` | `GET /warehouse/returns` | = `serializeReturn` + join keys |
| Return | `warehouseReturn.findOwnReturnOrThrow` | `findOne({_id,warehouseId})` | …as above | rest | `GET /warehouse/returns/:id` | only the read-only detail path uses this |
| Pharmacy | `warehouseReturn.getReturnDetailForWarehouse` | `findById` | `nameAr nameEn phone` | rest | same | = `serializeWarehouseReturn` |
| Order | `warehouseReturn.approveReturn` | `findById` | `orderNumber` | all | `POST /warehouse/returns/:id/approve` | only the number goes into a notes string |
| ManufacturerDiscount | `manufacturerDiscount.listDiscountsForWarehouse` | `find({warehouseId})` | `manufacturerAr discountPercentage createdAt` | `warehouseId`, `updatedAt` | `GET /warehouse/discounts` | = `serializeDiscount` |
| ManufacturerDiscount | `manufacturerDiscount.getDiscountMapForWarehouse` | `find({warehouseId})` | `manufacturerAr discountPercentage` | rest | catalog list + order pricing (internal, hot) | only the `(name → %)` pair builds the map |
| WarehouseManufacturer | `warehouseManufacturer.listManufacturersForWarehouse` | `find({warehouseId})` | `manufacturerAr` | `warehouseId`, timestamps | `GET /warehouse/manufacturers` + discounts dropdown | only `row.manufacturerAr` is read |
| Offer | `warehouseOffer.listOffersForWarehouse` | `find({warehouseId})` | `productId titleAr titleEn discountPercentage startDate endDate status createdAt` | `warehouseId`, `approvedBy`, `approvedAt`, `updatedAt` | `GET /warehouse/offers` | = `serializeOffer` |
| Product (+ populated `masterProductId`) | `warehouseOffer.listOffersForWarehouse` | `find({_id:{$in}}).populate(select)` | product: `nameAr nameEn manufacturerAr manufacturerEn masterProductId`; catalog: `nameAr nameEn manufacturerAr manufacturerEn` | `price`, `image`, `unit*`, `categoryId`, `description`, `barcode`, `priceHistory`, `isActive`, … | same | only the resolved name is shown; `applyResolvedIdentity` reads the 4 identity fields |
| Offer | `adminOffer.listPendingOffers` / `…Paginated` | `find({status:'pending'})` | `titleAr titleEn discountPercentage startDate endDate createdAt productId warehouseId` | `status`, `approvedBy`, `approvedAt`, `updatedAt` | `GET /admin/offers` | = `serializePendingOffer` + join keys |
| Product (+ populated) | `adminOffer.listPendingOffers` / `…Paginated` | `find({_id:{$in}}).populate(select)` | product: identity + `price`; catalog: identity | rest incl. `priceHistory` | same | `serializePendingOffer` reads resolved name + `price` |
| Warehouse | `adminOffer.listPendingOffers` / `…Paginated` | `find({_id:{$in}})` | `nameAr nameEn` | rest | same | names only |
| ProductCatalog (populated) | `adminProduct.listAllProducts` / `…Paginated` | `.populate({select:'nameAr nameEn manufacturerAr manufacturerEn'})` | identity | `priceUsd`, `categoryId`, `unit*`, `isActive`, timestamps | `GET /admin/products` | populated entry is only used for identity resolution |
| Warehouse | `adminProduct.listAllProducts` / `…Paginated` (join) | `find({_id:{$in}})` | `nameAr nameEn` | rest | same | `serializeAdminProduct` reads the two names |
| Warehouse | `adminProduct.listWarehousesWithProducts` | `find({_id:{$in}})` | `nameEn` | everything else | `GET /admin/products/warehouses` | maps to `{id, nameEn}` |
| Banner | `adminBanner.listBanners` / `…Paginated` | `find(filter)` | `bannerNumber imageUrl productId manufacturerAr title status rejectionNote startDate endDate warehouseId createdAt` | `approvedBy`, `createdBy`, `updatedAt` | `GET /admin/banners` | = `serializeAdminBanner` |
| Warehouse | `adminBanner.listBanners` / `…Paginated` (join) | `find({_id:{$in}})` | `nameAr nameEn` | rest | same | names only |
| Product (+ populated) | `adminBanner.listBanners` / `…Paginated` / `createAdminBanner` | `find/findOne(...).populate(select)` | identity fields | rest incl. `priceHistory` | `GET /admin/banners`, `POST /admin/banners` | `serializeAdminBanner` reads the resolved name; create reads `manufacturerAr` |
| Banner | `warehouseBanner.listPaginatedBannersForWarehouse` | `find(filter)` | `bannerNumber imageUrl productId manufacturerAr title status rejectionNote startDate endDate createdAt` | `warehouseId`, `approvedBy`, `createdBy`, `updatedAt` | `GET /warehouse/banners` | = `serializeWarehouseBanner` |
| ProductCatalog (populated) | `warehouseProduct.listProductsForWarehouse` / `…Paginated` | `.populate({select:'nameAr nameEn manufacturerAr manufacturerEn'})` | identity | rest of catalog doc | `GET /warehouse/products` | populated entry only used for identity resolution |
| Product (+ populated `masterProductId`) | `product.fetchMatchingPage` + `product.listWarehouseProducts` (search) | `find(...).populate(select)` | `categoryId nameAr nameEn manufacturerAr manufacturerEn image unitAr unitEn price isAvailable masterProductId`; catalog: identity | `description`, `barcode`, `manuallyDisabled`, `lastPriceUpdate`, `priceHistory[]`, `warehouseId`, `isActive`, timestamps | `GET /warehouse/catalog` (browsing) | = `serializeProductWithOffer` + `manufacturerAr` (discount map/filter) + `_id` (offer map/cursor) + sort key |
| Offer | `product.listWarehouseProducts` | `find({warehouseId,status,dates,productId:{$in}})` | `productId discountPercentage titleAr titleEn` | `warehouseId`, `status`, dates, `approvedBy`, `approvedAt`, timestamps | same | `serializeProductWithOffer` reads `discountPercentage`/`title*`; join key `productId` |
| ExchangeRate | `pharmacyBalance.recomputeBalance` | `findById` | `usdToSyp` | `source`, `lastUpdated`, `manualOverride` | internal (balance recompute) | only `rate.usdToSyp` is read here |
| Pharmacy | `pharmacyBalance.listPaginatedDebtorsForWarehouse` | `find({_id:{$in}})` | `nameAr nameEn phone` | rest | `GET /warehouse/balances` | = `serializeDebtorRow` |
| Warehouse | `pharmacyBalance.listDebtsForPharmacy` | `find({_id:{$in}})` | `nameAr nameEn phone` | rest | `GET /pharmacy/debts` | = `serializeDebtRow` |
| Pharmacy / Warehouse | `pharmacyBalance.getBalanceDetail` | `findById` | `nameAr nameEn phone` | rest | `GET /warehouse/balances/:id`, `GET /pharmacy/debts/:id` | `toBalanceDetailResponse` shows only the "other party" id/names/phone |

### Deferred — requires further investigation

| Query | Why deferred |
|---|---|
| `order.createOrder` — `Warehouse.findById`, `Product.find(...).populate`, `Offer.find` | Feed the SYP/USD pricing calculation (`discountRate`, `commissionRate`, `min/maxOrderAmountUsd`, per-product `price`/`isAvailable`/identity, offer `discountPercentage`). Order creation is low-frequency; a missed field mis-prices an order. Needs its own test before projecting. |
| `warehouseOrder.updateOrderItems` — the add-items `Product.find(...).populate` + `Warehouse.findById` | Same pricing calculation as `createOrder`, inside a mutation. `currentItems` there is mutated + saved and must stay unprojected. |
| `adminProduct.viewmodel` / `warehouseProduct.viewmodel` — the `Product` document | Read almost every product field, including the unbounded `priceHistory` array. A useful projection here is a separate slice that decides how to shape `priceHistory`. Only the `.populate()` select was applied. |

### Not applicable (no meaningful projection)

- `productCatalog.service.js` `listCatalog` / `searchActiveForWarehouse` — `serializeCatalogItem` emits every stored field.
- `exchangeRate.service.js` `getRate` — all four fields are used downstream.
- `otp.service.js` `verifyOtp` — mutates + saves; module is dormant.
- `PharmacyBalance` / `Payment` list+detail documents — tiny docs, viewmodels read nearly all fields.
- `complaint.service.js` / `warehouseComplaint` / `adminComplaint` / `notification.service.js` — **already** `.select()`d (prior change); re-verified.

### Verification

- `node --test test/**/*.test.js` → **139 pass, 0 fail** (117 before this pass
  + 22 new).
- New: `test/projection.select.test.js` — seeds one coherent dataset and pins
  the **viewmodel output** of every projected list/detail endpoint (admin
  pending accounts, pharmacy + warehouse orders list & detail, returnable
  orders, reviews both directions, warehouse profile + list, returns both
  directions + detail, offers both, discounts, active/admin/warehouse banners,
  debtor/debt lists + balance detail). Each asserts specific values that would
  be `undefined` if a needed field had been projected out.
- Extended `test/catalog.search.test.js` — the catalog list now also runs
  through `product.viewmodel.toProductListResponse` and asserts every emitted
  key (`priceUsd`, `isAvailable`, `image`, `unitAr`, …) survives the product
  projection, with prices round-tripping for linked and legacy products.
- Extended `test/readpath.lean.test.js` (from the auth slice) — warehouse
  `GET /auth/me`, `loginWithPassword` (wrong password + blocked still
  rejected), `registerOrLogin` re-entry.
- The existing oracle test in `catalog.search.test.js` (runs the *original*
  populate-everything algorithm and requires identical rows) still passes with
  the `.populate({ select })` narrowing.

### Measurements

Representative-document BSON size returned MongoDB → Node — a size delta on
sample data, **not** an aggregate over real traffic. Sample docs use realistic
field values and array lengths (a 5-entry `statusHistory`, a 3-entry
`priceHistory`, a 2-image return).

| Query | Before | After | Saved |
|---|---:|---:|---:|
| Warehouse — card (list) | 566 B | 244 B | 57% |
| Warehouse — profile detail | 566 B | 374 B | 34% |
| Warehouse — name-only join | 566 B | 108 B | 81% |
| Pharmacy — admin / order join | 562 B | 272 B | 52% |
| Pharmacy — name+phone join | 562 B | 124 B | 78% |
| Category (list row) | 182 B | 135 B | 26% |
| Banner — active (home slider) | 392 B | 167 B | 57% |
| Order — pharmacy list row | 700 B | 179 B | 74% |
| OrderItem — returnable list row | 342 B | 192 B | 44% |
| Review — recent-reviews row | 269 B | 204 B | 24% |
| Return — linked (order detail) | 486 B | 77 B | 84% |
| Offer — catalog row | 317 B | 144 B | 55% |
| ManufacturerDiscount — pricing map | 160 B | 88 B | 45% |
| Product — catalog browse row | 764 B | 240 B | 69% |

Plus, from the auth slice: `GET /auth/me` (user + pharmacy, 3 device tokens)
1454 B → 408 B (72%); the projected `User` is a constant ~126 B regardless of
device count.

### Expected benefit (qualitative)

- **Less data transferred MongoDB → Node** on every list and detail endpoint,
  scaling with page size — a 20-row order or product list now moves a fraction
  of the bytes.
- **Less Mongoose/BSON deserialization** per request; unbounded arrays
  (`priceHistory`, `statusHistory`, return `items`/`images`, `deviceTokens`)
  are no longer parsed on paths that never read them.
- **`.populate({ select })`** stops fetching the full `ProductCatalog` document
  for every catalog row, offer row and banner row — only the four identity
  fields cross the wire.
- **Lower transient per-request memory**; smaller working set on the hot
  browsing and order-list paths.
- API responses byte-for-byte unchanged — no client impact, no change to
  outbound serialization.

---

## Level 2 — MongoDB Query & Index Optimization

Goal: make the frequently-used and expensive read queries scan as little data
as possible, with the smallest useful index set, without changing any query
filter, sort, pagination, or response.

**How this was measured.** The dev database is tiny (< 10 docs in most
collections), so `explain()` there is meaningless. A synthetic-but-shaped
dataset was seeded into a throwaway database (4 000 users, 800 warehouses,
3 000 pharmacies, 50 000 orders, 30 000 reviews, 8 000 returns, ~16 700
pharmacy-balances, 40 000 products) with a few deliberate "power users"
(one warehouse ≈ 2 400 orders / 1 200 reviews / 3 000 debtor balances, one
pharmacy ≈ 700 orders), and `explain("executionStats")` was run against each
candidate query with the **baseline** indexes and again with the **Level 2**
set. `docsExamined`, `keysExamined`, `nReturned` and the winning plan are the
signals reported; `executionTimeMillis` on a just-migrated dev instance is
cache-cold noise and is not used as evidence.

### Audit — queries inspected

| Query | Collection | Filter → Sort | Baseline plan | Verdict |
|---|---|---|---|---|
| `auth.middleware` / `auth.getMe` / `loginWithPassword` | users | `_id` / `phone` (unique) | IXSCAN | healthy |
| `warehouse.isWarehouseAvailable` | warehouses / users | `_id` / `userId` | IXSCAN | healthy |
| `warehouse.listAvailableWarehouses` (users part) | users | `{role,status}` | **COLLSCAN 4000** | **fix** — `{role:1,status:1}` |
| `warehouse.listAvailableWarehouses` (wh part) | warehouses | `{userId:{$in}},isActive` | IXSCAN(`userId_1`) | healthy |
| `warehouse.getWarehouseProfile` | warehouses | `_id` | IDHACK | healthy |
| `category.listCategories` | categories | `{}` → `{sortOrder,nameEn}` | COLLSCAN (~4 docs) | leave — tiny reference collection |
| `banner.listActiveBanners` | banners | `{status,startDate,endDate}` → `createdAt` | IXSCAN(`status_1_startDate_1_endDate_1`) | leave — small collection, existing compound adequate |
| `product.listWarehouseProducts` (browse, no category) | products | `{warehouseId,isActive}` → `_id` | FETCH ← IXSCAN(`_id_`) — 472 examined / 60 | **fix** — `{warehouseId:1,_id:1}` |
| `product.listWarehouseProducts` (browse, category) | products | `{warehouseId,isActive,categoryId}` → `_id` | FETCH ← IXSCAN(`_id_`) — 826 / 60 | **fix** — `{warehouseId:1,categoryId:1,_id:1}` |
| `product.listWarehouseProducts` (search) | productcatalogs / products | RegExp `$or` | COLLSCAN (unanchored `/x/i` can't use a b-tree) | leave — see "text index" finding |
| `product.listDistinctManufacturers…` | products | `distinct(field, {warehouseId,isActive,…})` | IXSCAN(`warehouseId_1_categoryId_1` prefix) | healthy (uses the new `{warehouseId:1,…}` prefix) |
| `order.listOrdersForPharmacy` | orders | `{pharmacyId}` → `{orderNumber:-1}` | **SORT ← IXSCAN(`pharmacyId_1`)** — 735 / 16 | **fix** — `{pharmacyId:1,orderNumber:-1}` |
| `order.listReturnableOrders` | orders | `{pharmacyId,status,updatedAt:{$gte}}` → `_id` | **SORT ← IXSCAN(`pharmacyId_1`)** — 735 / few | **fix** — `{pharmacyId:1,status:1,updatedAt:-1}` |
| `order.getOrderForPharmacy` (+ mutation loads) | orders | `{_id,pharmacyId}` | IDHACK | healthy |
| `warehouseOrder.listOrdersForWarehouse` (status tab) | orders | `{warehouseId,status}` → `{orderNumber:1}` | **SORT ← IXSCAN(`warehouseId_1`)** — 2375 / 21 | **fix** — `{warehouseId:1,status:1,orderNumber:1}` |
| `warehouseOrder.listOrdersForWarehouse` (all tab) | orders | `{warehouseId}` → `{orderNumber:1}` | **SORT ← IXSCAN(`warehouseId_1`)** — 107 / 21 | **fix** — `{warehouseId:1,orderNumber:1}` |
| `warehouseOrder` detail / status / edit loads | orders | `{_id,warehouseId}` | IDHACK | healthy (write paths, untouched) |
| `pharmacyBalance.recomputeBalance` / `getBalanceDetail` | orders | `{pharmacyId,warehouseId,status:'delivered'}` | SORT ← IXSCAN(`pharmacyId_1`) — 735 / few | **partial fix** — served by `{pharmacyId:1,status:1,updatedAt:-1}` prefix (735 → 112); a dedicated `{pharmacyId:1,warehouseId:1,status:1}` deferred |
| `complaint.resolveRelatedOrder` | orders | `{orderNumber,pharmacyId,warehouseId}` | IXSCAN(`orderNumber_1` unique) | healthy |
| `review.listReviewsForPharmacy` | reviews | `{pharmacyId,reviewerType}` → `createdAt` | **SORT ← COLLSCAN 30000** | **fix** — `{pharmacyId:1,reviewerType:1,createdAt:-1}` |
| `warehouseReview.listReviewsForWarehouse` (profile) | reviews | `{warehouseId,reviewerType,isVisible}` → `createdAt` | **SORT ← COLLSCAN 30000** | **fix** — `{warehouseId:1,reviewerType:1,isVisible:1,_id:-1}` |
| `warehouseReview.listPaginatedReviewsForWarehouse` | reviews | same → `{_id:-1}` limit 16 | FETCH ← IXSCAN(`_id_`) — **10751** / 16 | **fix** — same index (served directly) |
| `warehouseReview.getReviewStatsForWarehouse` | reviews | `$match` same, `$group` rating | **COLLSCAN 30000** | **fix** — same index |
| `warehouseReview.createPharmacyReview` (guards) | orders / reviews | `{_id,warehouseId}` / dup-check | IDHACK / IXSCAN(unique) | healthy |
| `return.listReturnsForPharmacy` | returns | `{pharmacyId}` → `{_id:-1}` | IXSCAN(`pharmacyId_1`) reverse — small per pharmacy | healthy (kept `pharmacyId_1`) |
| `return.createReturn` (guards) | orders / returns | `{_id,pharmacyId}` / `{orderId}` | IDHACK / IXSCAN(unique) | healthy |
| `warehouseReturn.listReturnsForWarehouse` (non-paginated) | returns | `{warehouseId,status?}` → `{createdAt:1}` | FETCH ← IXSCAN + SORT (~125) | acceptable (small per warehouse); served by `{warehouseId:1,status:1,_id:-1}` prefix |
| `warehouseReturn.listPaginatedReturnsForWarehouse` (status tab) | returns | `{warehouseId,status}` → `{_id:-1}` limit 16 | **SORT ← IXSCAN(`warehouseId_1_status_1`)** — 160 / 16 | **fix** — `{warehouseId:1,status:1,_id:-1}` |
| `warehouseReturn.listPaginatedReturnsForWarehouse` (all tab) | returns | `{warehouseId}` → `{_id:-1}` limit 16 | FETCH ← IXSCAN(`_id_`) — 249 / 16 | **fix** — `{warehouseId:1,_id:-1}` |
| `pharmacyBalance.listPaginatedDebtorsForWarehouse` | pharmacybalances | `{warehouseId,balanceUsd:{$gt:0}}` → `{balanceUsd:-1,_id:1}` | **SORT ← COLLSCAN 16750** | **fix** — `{warehouseId:1,balanceUsd:-1,_id:1}` |
| `pharmacyBalance.listDebtsForPharmacy` | pharmacybalances | `{pharmacyId,balanceUsd:{$gt:0}}` → `{balanceUsd:-1}` | IXSCAN(`pharmacyId_1_warehouseId_1` prefix) + SORT (~8) | healthy — a pharmacy owes few warehouses |
| `Payment.find({pharmacyId,warehouseId})` | payments | `{pharmacyId,warehouseId}` | IXSCAN(`pharmacyId_1_warehouseId_1`) | healthy |
| `notification.isRateLimited` | notifications | `{userId,type,createdAt:{$gte}}` limit 1 | IXSCAN(`userId_1_createdAt_-1`) + FETCH filter `type` | healthy (findOne, tiny) |
| `admin.listPendingAccounts` / `…Paginated` | users | `{status,role}` → `{createdAt:1}` / `{_id:1}` | **COLLSCAN 4000** | **fix** — `{role:1,status:1}` (paginated `_id` sort served by its prefix; dashboard `createdAt` sort still a small SORT) |
| `admin.countPendingAccountsByRole` / `broadcastNotification` | users | `{status,role}` / `{status,role:{$in}}` | COLLSCAN | **fixed** by `{role:1,status:1}` |
| `adminOffer.listPendingOffers` / `…Paginated` | offers | `{status:'pending'}` → `{createdAt}` / `{_id}` | COLLSCAN (no `status`-prefix index) | deferred — offers stays small, admin-only, low frequency |
| `adminProduct.listAllProducts` / `…Paginated` | products | `{}` / `{warehouseId?,$or regex}` | COLLSCAN | leave — admin oversight view is inherently a scan of the whole (or one warehouse's) catalog |
| Category / Offer / Banner / Manufacturer / Discount lists per warehouse | — | `{warehouseId}` | IXSCAN or small COLLSCAN | healthy — few rows per warehouse |

### Existing indexes (verified against the live database, not just the schemas)

`db.<collection>.indexes()` on the dev database confirmed the schema
declarations exactly, with **no drift** and no manually-added indexes.
`complaints` did not exist yet (new feature, not deployed); its
schema-declared indexes (`complaintNumber` unique + three `{x, createdAt:-1}`
compounds) were reviewed from the model file — see "Deferred".

| Collection | Indexes found (excl. `_id_`) |
|---|---|
| users | `phone_1` (unique) |
| warehouses | `userId_1`, `city_1` |
| pharmacies | `userId_1`, `city_1`, `location_2dsphere` |
| products | `warehouseId_1_categoryId_1`, `nameAr_text_…` (text), `warehouseId_1_masterProductId_1` (unique, partial `masterProductId:{$type:objectId}`) |
| productcatalogs | `nameAr_1_manufacturerAr_1` (unique) |
| orders | `orderNumber_1` (unique), `pharmacyId_1`, `warehouseId_1`, `status_1` |
| orderitems | `orderId_1`, `productId_1` |
| returns | `orderId_1` (unique), `warehouseId_1_status_1`, `pharmacyId_1` |
| reviews | `orderId_1_reviewerType_1` (unique) |
| offers | `productId_1`, `warehouseId_1_status_1` |
| banners | `status_1_startDate_1_endDate_1`, `bannerNumber_1` (unique) |
| notifications | `userId_1_isRead_1`, `userId_1_createdAt_-1` |
| payments | `pharmacyId_1_warehouseId_1` |
| pharmacybalances | `pharmacyId_1_warehouseId_1` (unique) |
| manufacturerdiscounts / warehousemanufacturers | `warehouseId_1_manufacturerAr_1` (unique) |
| otps | `phone_1_expiresAt_1`, `expiresAt_1` (TTL 0s) |

### Findings

**Already healthy (no change):**

- Every `_id` / `orderNumber` / `phone` / `{userId}` / `{orderId}` /
  `{pharmacyId,warehouseId}` lookup — direct IXSCAN, `docsExamined ≈ nReturned`.
- `orderitems` — every query is `{orderId}` or `{orderId:{$in}}`, covered by
  `orderId_1`.
- Per-warehouse offer / discount / manufacturer / banner lists — a handful of
  rows each; the existing `{warehouseId,…}` indexes or a tiny scan are fine.
- `notification.isRateLimited` — `findOne` on `{userId_1_createdAt_-1}`.
- `pharmacyBalance.listDebtsForPharmacy` — a pharmacy owes few warehouses.

**Missing a useful index (COLLSCAN on a query that scales) — fixed:**

1. **`reviews` had only the dup-check index.** Every "reviews received by
   warehouse X" and "by pharmacy X" query — the pharmacist's warehouse-profile
   screen (browsing path), both panel review lists, and the rating-distribution
   `$group` aggregate — was a full `reviews` collection scan
   (`docsExamined 30 000`, and one aggregate at ~900 ms in the harness).
2. **`users` had no `{role, status}` index.** `GET /warehouses` (browsing) runs
   `users.find({ role:'warehouse', status:'active' })` on every call — a full
   `users` scan. Same for the three admin pending-account queries.
3. **`pharmacybalances` had no `warehouseId`-prefixed index** (only
   `{pharmacyId, warehouseId}`). The warehouse "who owes me" list was a full
   scan + in-memory sort of every balance row in the system.

**Filter served but sort not (in-memory SORT that grows with one user's
history) — fixed:**

4. **`orders.listOrdersForPharmacy`** — `{pharmacyId_1}` served the filter, then
   an in-memory sort of every one of that pharmacy's orders to take the top 16.
5. **`orders.listOrdersForWarehouse`** — worse: the planner picked
   `orderNumber_1` for the sort and FETCH-filtered `warehouseId`+`status`,
   examining 2 375 rows to return 21 for the "pending" tab.
6. **`products` catalog browse** — the planner used `_id_` for the `_id` sort
   and FETCH-filtered `warehouseId`; a category-filtered scroll examined 826
   rows for 60. The existing `{warehouseId,categoryId}` index didn't help
   because it doesn't carry the `_id` sort key.
7. **`returns` paginated queues** — `{warehouseId,status}` didn't carry the
   `_id` pagination key.

**Unused index — removed:**

8. **`products` text index** (`nameAr/nameEn/manufacturerAr/manufacturerEn`).
   Level 1 rewrote catalog search to a case-insensitive `RegExp` match on the
   `ProductCatalog` master list; a repository-wide grep finds **zero** `$text`
   queries. The index cost a 4-field tokenisation on every product write for
   no reader.

### Changes

For every index — keys, the queries it serves, the evidence, and the write
trade-off. Added indexes are declared on the schemas (Mongoose `autoIndex`
creates them on the next boot); superseded/unused indexes are dropped by
`scripts/level2-index-migration.js` (`npm run migrate-level2-indexes`,
idempotent).

| Collection | Index | Keys | Serves | Why (evidence) | Trade-off |
|---|---|---|---|---|---|
| reviews | **add** | `{warehouseId:1, reviewerType:1, isVisible:1, _id:-1}` | `listReviewsForWarehouse` (profile), `listPaginatedReviewsForWarehouse`, `getReviewStatsForWarehouse` | COLLSCAN 30 000 → IXSCAN; paginated 10 751 → 16 examined; aggregate scan eliminated | `reviews` is append-mostly (created once, `isVisible` rarely toggled, never deleted) — negligible |
| reviews | **add** | `{pharmacyId:1, reviewerType:1, createdAt:-1}` | `listReviewsForPharmacy` | COLLSCAN 30 000 → 7 examined, SORT eliminated | as above |
| users | **add** | `{role:1, status:1}` | `listAvailableWarehouses` (users part), `admin.listPendingAccounts`/`…Paginated`/`countPendingAccountsByRole`, `broadcastNotification` | COLLSCAN 4 000 → IXSCAN (700 / 1 100 examined = `nReturned`) | `users` is a low-write collection — negligible |
| pharmacybalances | **add** | `{warehouseId:1, balanceUsd:-1, _id:1}` | `listPaginatedDebtorsForWarehouse` (filter + `{balanceUsd:-1,_id:1}` sort + the `$or` compound cursor) | COLLSCAN 16 750 + SORT → 21 examined, SORT eliminated | balances are recomputed in place (`findOneAndUpdate`); one extra index on a moderate-write collection |
| orders | **add** | `{pharmacyId:1, orderNumber:-1}` | `listOrdersForPharmacy` | SORT ← IXSCAN 735 → LIMIT ← IXSCAN 16 | an order is written once + ~4 status transitions; see note below |
| orders | **add** | `{warehouseId:1, status:1, orderNumber:1}` | `listOrdersForWarehouse` (status tab — the primary warehouse screen) | SORT ← IXSCAN 2 375 → LIMIT ← IXSCAN 21 | as above; `{warehouseId,status}` prefix also replaces `warehouseId_1` |
| orders | **add** | `{warehouseId:1, orderNumber:1}` | `listOrdersForWarehouse` (all tab, no status filter) | SORT ← IXSCAN 107 → LIMIT ← IXSCAN 21 | as above |
| orders | **add** | `{pharmacyId:1, status:1, updatedAt:-1}` | `listReturnableOrders`; its `{pharmacyId,status}` prefix also narrows `recomputeBalance`/`getBalanceDetail` | returnable 735 → 0–1 examined; balance recompute 735 → 112 | as above; `{pharmacyId}` prefix replaces `pharmacyId_1` |
| orders | **drop** | `pharmacyId_1`, `warehouseId_1`, `status_1` | — | each is a strict prefix of a new compound (`status_1` is used by no query at all) | −3 indexes offsets the +4 |
| returns | **add** | `{warehouseId:1, status:1, _id:-1}` | `listPaginatedReturnsForWarehouse` (status tab), `listReturnsForWarehouse` (via prefix) | SORT ← IXSCAN 160 → LIMIT ← IXSCAN 16 | returns are low-volume; `{warehouseId,status}` prefix replaces the old 2-field index |
| returns | **add** | `{warehouseId:1, _id:-1}` | `listPaginatedReturnsForWarehouse` (all tab) | FETCH ← IXSCAN(`_id_`) 249 → LIMIT ← IXSCAN 16 | as above |
| returns | **drop** | `warehouseId_1_status_1` | — | covered by the new `{warehouseId,status,_id:-1}` prefix | net 0 |
| products | **add** | `{warehouseId:1, categoryId:1, _id:1}` | catalog browse with a category filter; `warehouseProduct.listProductsForWarehouse` + manufacturer `distinct` via its prefix | 826 → 62 examined, SORT/`_id_`-detour eliminated | products get frequent price edits; `+_id` on an existing index is cheap, `warehouseId_1_categoryId_1` is dropped |
| products | **add** | `{warehouseId:1, _id:1}` | catalog browse with no category filter (warehouse-wide scroll) | 472 → 62 examined | one extra index; offset by dropping the text index |
| products | **drop** | `warehouseId_1_categoryId_1` | — | strict prefix of the new 3-field index | net 0 |
| products | **drop** | `nameAr_text_…` (text) | — | unused — zero `$text` queries in the codebase (Level 1 made search RegExp-based) | removes a 4-field tokenisation on every product write |

**Order-index count note.** Baseline: 4 non-`_id` indexes
(`orderNumber` + 3 single-field). Level 2: 5 (`orderNumber` + 4 compounds).
Net **+1** index on `orders` for a query-plan improvement across the two
primary dashboards, the returnable-orders screen, and the delivery→balance
recompute path. An order document is written once and updated a handful of
times over its life, so the marginal write cost is small.

### Before / After (synthetic-scale `explain("executionStats")`)

`d` = `docsExamined`, `k` = `keysExamined`, `n` = `nReturned`.

| Query | Before plan | Before d / k / n | After plan | After d / k / n |
|---|---|---|---|---|
| `reviews.listReviewsForWarehouse` (profile) | `SORT ← COLLSCAN` | 30000 / 0 / 1209 | `SORT ← FETCH ← IXSCAN(wh_type_visible_id)` | 1209 / 1209 / 1209 |
| `reviews.listPaginatedReviewsForWarehouse` | `LIMIT ← FETCH ← IXSCAN(_id_)` | 10751 / 10751 / 16 | `LIMIT ← FETCH ← IXSCAN(wh_type_visible_id)` | 16 / 16 / 16 |
| `reviews.getReviewStatsForWarehouse` ($group) | `COLLSCAN` | 30000 / 0 / 1209 | `FETCH ← IXSCAN(wh_type_visible_id)` | 1209 / 1209 / 1209 |
| `reviews.listReviewsForPharmacy` | `SORT ← COLLSCAN` | 30000 / 0 / 7 | `FETCH ← IXSCAN(pharm_type_created)` | 7 / 7 / 7 |
| `users.listAvailableWarehouses` | `PROJECTION ← COLLSCAN` | 4000 / 0 / 700 | `PROJECTION ← FETCH ← IXSCAN(role_status)` | 700 / 700 / 700 |
| `users.listPendingAccounts` | `SORT ← PROJECTION ← COLLSCAN` | 4000 / 0 / 1100 | `SORT ← PROJECTION ← FETCH ← IXSCAN(role_status)` | 1100 / 1101 / 1100 |
| `pharmacybalances.listPaginatedDebtorsForWarehouse` | `SORT ← COLLSCAN` | 16750 / 0 / 21 | `LIMIT ← FETCH ← IXSCAN(wh_balance_id)` | 21 / 21 / 21 |
| `orders.listOrdersForPharmacy` | `SORT ← FETCH ← IXSCAN(pharmacyId_1)` | 735 / 735 / 16 | `LIMIT ← FETCH ← IXSCAN(pharm_orderNumber)` | 16 / 16 / 16 |
| `orders.listOrdersForWarehouse` (status tab) | `SORT ← FETCH ← IXSCAN(warehouseId_1)` | 2375 / 2375 / 21 | `LIMIT ← FETCH ← IXSCAN(wh_status_orderNumber)` | 21 / 21 / 21 |
| `orders.listOrdersForWarehouse` (all tab) | `SORT ← FETCH ← IXSCAN(warehouseId_1)` | 107 / 107 / 21 | `LIMIT ← FETCH ← IXSCAN(wh_orderNumber)` | 21 / 21 / 21 |
| `orders.listReturnableOrders` | `SORT ← FETCH ← IXSCAN(pharmacyId_1)` | 735 / 735 / few | `SORT ← FETCH ← IXSCAN(pharm_status_updated)` | 0–1 / 0–1 / few |
| `orders` balance recompute / `getBalanceDetail` | `SORT ← FETCH ← IXSCAN(pharmacyId_1)` | 735 / 735 / 4 | `SORT ← FETCH ← IXSCAN(pharm_status_updated)` | 112 / 112 / 4 |
| `products` catalog browse (no category) | `LIMIT ← FETCH ← IXSCAN(_id_)` | 472 / 472 / 60 | `LIMIT ← FETCH ← IXSCAN(wh_id)` | 62 / 62 / 60 |
| `products` catalog browse (category) | `LIMIT ← FETCH ← IXSCAN(_id_)` | 826 / 826 / 60 | `LIMIT ← FETCH ← IXSCAN(wh_cat_id)` | 62 / 62 / 60 |
| `returns.listPaginated…` (status tab) | `SORT ← FETCH ← IXSCAN(warehouseId_1_status_1)` | 160 / 160 / 16 | `LIMIT ← FETCH ← IXSCAN(wh_status_id)` | 16 / 16 / 16 |
| `returns.listPaginated…` (all tab) | `LIMIT ← FETCH ← IXSCAN(_id_)` | 249 / 249 / 16 | `LIMIT ← FETCH ← IXSCAN(wh_id)` | 16 / 16 / 16 |

Residual `SORT` stages (`listReviewsForWarehouse` over its ≤ N matched rows,
`listPendingAccounts` over the pending set, `listReturnableOrders` /
`getBalanceDetail` over a handful) are all over small, already-fetched,
bounded result sets — not worth an extra index each.

`executionTimeMillis` is not tabulated: on a dev instance immediately after an
index build it is dominated by cold-cache page-ins and background load (some
`AFTER` timings were *higher* than `BEFORE` despite 20–1000× fewer
`docsExamined`). The plan + examined-doc counts are the durable signal.

### Deferred

| Item | Why |
|---|---|
| `order.createOrder` / `warehouseOrder.updateOrderItems` pricing reads (`Warehouse.findById`, `Product.find(...).populate`, `Offer.find`) | The three **Level 1 deferred pricing queries**. All are `_id` / `{_id:{$in}}` / `{warehouseId,status,productId:{$in}}` lookups already served by existing indexes; there is no index problem here and the pricing logic stays untouched. |
| `orders` dedicated `{pharmacyId:1, warehouseId:1, status:1}` | Would take `recomputeBalance` from 112 → 3 examined for a *power-user* pharmacy (normal pharmacies see ~5). Not worth a 6th order index; the `{pharmacyId,status,updatedAt}` prefix already removed the COLLSCAN-equivalent. Revisit if balance recompute shows up in production profiling. |
| `offers` `{status:1, _id:1}` for the admin pending-offers queue | Currently a COLLSCAN, but `offers` is inherently small (a few per warehouse, approved ones the only ones that accumulate) and the queue is admin-only / low-frequency. Add if the collection grows past a few thousand. |
| `categories` `{sortOrder:1, nameEn:1}` | Would remove a sort, but the collection is a few dozen rows — below the threshold where an index earns its keep. |
| `notifications` `{userId:1, isRead:1}` | Currently unused (no notification-list endpoint exists yet) but obviously intended for an unread-count / mark-read feature. Left in place. |
| `complaints` indexes (`{pharmacyId,createdAt:-1}` etc.) | The collection does not exist yet (feature undeployed). The declared indexes sort by `createdAt` while the service paginates on `_id` — a minor mismatch to flag to the feature author — but complaint volume is inherently tiny (support tickets) and there is no data to measure. Not changed. |
| `adminProduct.listAllProducts` / `listPaginatedAllProducts` | The admin oversight view is a deliberate scan of the entire (or one warehouse's) catalog with a RegExp search; a cursor index on `_id` exists, and a covering index for an unanchored RegExp is not possible. |
| `admin.listAccounts` / `countAccounts` (the Accounts management page) | Filter path (`{role:{$in:[pharmacy,warehouse]}, status?}` → `{_id:-1}` cursor) is served by the existing `users` `{role:1,status:1}` index. The optional `search` term does an unanchored case-insensitive RegExp pre-match on `pharmacies` / `warehouses` (`nameAr/nameEn/ownerName/city/phone`) — a COLLSCAN of those small, low-write, admin-only collections, same deliberate tradeoff as `adminProduct` search. No name index added (an unanchored `/x/i` can't use a b-tree). Both list and count queries are `.lean()` (read-only → viewmodel only; block/unblock/approve/reject each load their own document). Revisit with an anchored search or `$text` if account volume grows large. |

### Deployment notes

- The **added** indexes are picked up automatically by Mongoose `autoIndex` on
  the next boot. On a large production `orders` / `reviews` / `products`
  collection, prefer building them ahead of the deploy (`createIndex` in a
  maintenance window or a rolling secondary build) rather than letting boot do
  it, to avoid a slow first start.
- Run **`npm run migrate-level2-indexes` once** after deploy to drop the six
  superseded/unused indexes. It is idempotent and safe to re-run.

### Verification

- `node --test test/**/*.test.js` → **141 pass, 0 fail** (unchanged from
  Level 1 — no behaviour change).
- `explain("executionStats")` before/after on the synthetic-scale dataset
  (table above).
- `scripts/level2-index-migration.js` dry-run against a fixture DB seeded with
  the baseline indexes: creates 12, drops 6, second run is a clean no-op.
- Repository grep for `$text` / `.text(` → zero matches (justifies the text
  index removal).
- Manual index audit (`db.<collection>.indexes()`) of the dev database →
  matches the schemas, with one **pre-existing** drift noted (not caused by,
  and out of scope for, Level 2): the dev `returns.orderId_1` index exists
  **without** its `unique` flag (the schema declares `orderId` unique, but the
  physical index predates that and Mongoose won't recreate it with new
  options). `return.createReturn`'s "one return per order" guard relies on
  that constraint — worth a `collMod` / drop-and-recreate on any environment
  showing the same drift.

### Final index list (modified collections)

```
orders
  _id_
  orderNumber_1                              {orderNumber:1}                       unique
  pharmacyId_1_orderNumber_-1                {pharmacyId:1, orderNumber:-1}
  warehouseId_1_status_1_orderNumber_1       {warehouseId:1, status:1, orderNumber:1}
  warehouseId_1_orderNumber_1                {warehouseId:1, orderNumber:1}
  pharmacyId_1_status_1_updatedAt_-1         {pharmacyId:1, status:1, updatedAt:-1}

reviews
  _id_
  orderId_1_reviewerType_1                             {orderId:1, reviewerType:1}                        unique
  warehouseId_1_reviewerType_1_isVisible_1__id_-1      {warehouseId:1, reviewerType:1, isVisible:1, _id:-1}
  pharmacyId_1_reviewerType_1_createdAt_-1             {pharmacyId:1, reviewerType:1, createdAt:-1}

users
  _id_
  phone_1                                    {phone:1}                            unique
  role_1_status_1                            {role:1, status:1}

pharmacybalances
  _id_
  pharmacyId_1_warehouseId_1                 {pharmacyId:1, warehouseId:1}         unique
  warehouseId_1_balanceUsd_-1__id_1          {warehouseId:1, balanceUsd:-1, _id:1}

returns
  _id_
  orderId_1                                  {orderId:1}                          unique
  pharmacyId_1                               {pharmacyId:1}
  warehouseId_1_status_1__id_-1              {warehouseId:1, status:1, _id:-1}
  warehouseId_1__id_-1                       {warehouseId:1, _id:-1}

products
  _id_
  warehouseId_1_masterProductId_1           {warehouseId:1, masterProductId:1}    unique, partial {masterProductId:{$type:objectId}}
  warehouseId_1_categoryId_1__id_1          {warehouseId:1, categoryId:1, _id:1}
  warehouseId_1__id_1                       {warehouseId:1, _id:1}
```

All other collections' indexes are unchanged from §4.
