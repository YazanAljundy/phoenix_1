# Money-Flow V2

How money works in Phoenix: what is stored, what is derived, and which rules
are load-bearing. Read this before changing anything that touches a balance.

The short version: **an immutable ledger is the source of truth, every monetary
event freezes its own exchange rate, and nothing is ever edited or deleted.**

---

## 1. The model

```
PRODUCT (price in USD)
   │  order time: × the rate captured NOW, frozen onto the order
   ▼
ORDER  ──── pending → confirmed → preparing → out_for_delivery ────┐
   │                                                              │
   │  no money moves at any of these                              │ delivered
   │                                                              ▼
   │                                              ONE `charge` LedgerEntry
   │                                              (inside the same transaction)
   ▼
LedgerAccount (one per pharmacy ↔ warehouse)
   ▲          ▲              ▲
   │          │              │
 payment   return_credit  manual_credit / manual_debit
   │          │              │
   └──────────┴──────────────┘
              │
      balanceCache.syp  =  Σ signed amountSyp   (a CACHE, never the truth)
              │
      ┌───────┴────────┐
      ▼                ▼
  STATEMENT        INVOICE          (both generated, never stored)
```

### Collections

| Collection | Role |
|---|---|
| `ledgeraccounts` | One per `(pharmacyId, warehouseId)`. Holds `seqCounter` and `balanceCache`. |
| `ledgerentries` | **The source of truth.** Immutable, append-only, signed. |
| `financialauditlogs` | Append-only narrative: who did what, when, before/after, why. |
| `exchangeratehistories` | Append-only trail of every rate the singleton has held. |
| `orders` / `orderitems` | Frozen price snapshot + frozen `fx`. |
| `payments` | Append-only. `status` is the only mutable field, `posted → reversed`, once. |
| `returns` | Carries the frozen credit valuation once approved. |
| `commissioncollections` | Warehouse-to-platform commission payments. **Not** a ledger. |

`pharmacybalances` was V1's balance. It is **deleted** — if you see it
referenced anywhere, that is a bug.

---

## 2. The rules that must not be broken

1. **A LedgerEntry is never updated and never deleted.** A mistake is undone by
   posting a `*_reversal` that references it and copies its amounts *and its
   rate* — so reverse-then-re-record is exactly FX-neutral.
2. **Every monetary event freezes its own exchange rate.** `Order.fx`,
   `Payment.fx`, `LedgerEntry.fx`. A rate change prices new events only; it can
   never reach back and restate an old one.
3. **SYP is the settlement currency.** `amountSyp` is a whole-lira integer, and
   the balance is an exact integer sum. `amountUsd` is a frozen 2dp *reporting
   projection* — never `balanceSyp / currentRate`.
4. **The balance is `Σ signed amountSyp`.** Positive = the pharmacy owes.
   `balanceCache` is defined as "whatever a full replay produces" and is
   verified nightly.
5. **Delivery is the only order event that moves money**, and it posts exactly
   one charge, guarded by a unique index on `(source.orderId, kind:'charge')`.
6. **Every financial write runs in one transaction.** Notifications, realtime
   emits and FCM are post-commit and best-effort — financial success means the
   transaction committed, nothing else.
7. **Manual adjustments, every reversal, and return rejections require a
   reason**, enforced in `ledger.postEntry`'s `REASON_REQUIRED_KINDS`.
8. **The frontend never computes an authoritative figure.** It renders server
   values.

---

## 3. Pricing

Computed once in `order.service.js`, shared with the pending-edit path via
`rollUpOrderMoney` so the two cannot drift.

```js
unitPrice     = round(product.price_USD × fx.rate)
discountPrice = stackedDiscountSyp(unitPrice, offer%, manufacturer%)   // per-stage rounding
subtotal      = Σ discountPrice × qty

// The advertisement package price is the base the platform discount comes off,
// NOT the catalog sum. Units beyond the advertised quantity are simply part of
// that base at their normal price.
advertisementDiscount = max(0, advertisedSubtotal − round(package.totalPriceUsd × fx.rate))
discountBase          = subtotal − advertisementDiscount
platformDiscount      = round(discountBase × warehouse.discountRate / 100)
finalPrice            = discountBase − platformDiscount        // what the pharmacy owes
commission            = round(finalPrice × warehouse.commissionRate / 100)
```

**The warehouse's effective cut off its own advertised price is therefore
predictable:**

```
discountRate + commissionRate × (1 − discountRate)   =  4% + 1%×0.96  =  4.96%
```

Worked example — catalog $67, package $40, rate 10,000, 4% + 1%:

| | SYP | USD |
|---|---:|---:|
| catalog subtotal (context only) | 670,000 | 67.00 |
| advertisement discount | −270,000 | |
| **discount base = the package price** | **400,000** | **40.00** |
| platform discount (4% of the base) | −16,000 | |
| **pharmacy pays** | **384,000** | **38.40** |
| commission (1% of what is paid) | −3,840 | |
| **warehouse nets** | **380,160** | **38.02** |
| effective cut off the $40 ad | | **4.96%** |

Pinned end-to-end in `test/advertisement.pricing.test.js`.

---

## 4. Returns

Approving a return **credits the pharmacy's account**. There is no replacement
order — that mechanism is gone.

```js
returnedGross  = Σ (orderItem.discountPrice × returnedQty)
reductionShare = round((platformDiscount + advertisementDiscount) × returnedGross / subtotal)
credit         = returnedGross − reductionShare

// when every unit is returned, pinned so the order's credits total EXACTLY
// its finalPrice - the remainder is absorbed rather than left as phantom debt
credit         = isFinalReturn ? (finalPrice − priorCredits) : credit
creditUsd      = credit / order.fx.rate          // the ORDER's rate, never today's
```

Offer and manufacturer discounts need no special handling — they are already
inside `discountPrice`. Commission is **not** deducted: the pharmacy is
credited what it was charged, and the warehouse's clawback happens separately
in the settlement report.

The whole working is frozen onto `Return.creditValuation` and copied into the
entry's `metadata`, so a statement or a dispute never recomputes it.

---

## 5. Idempotency & concurrency

| Operation | Mechanism |
|---|---|
| Create order | client `idempotencyKey`, unique per `(pharmacyId, key)` |
| Record / reverse payment | client `idempotencyKey`, globally unique |
| Manual adjustment | client `idempotencyKey` |
| Deliver order | CAS on `status` + unique `(orderId, kind:'charge')` |
| Approve / reject return | CAS on `Return.status` + unique `(returnId, kind:'return_credit')` |
| Reverse anything | unique partial index on `reversalOf` |

A replay returns **200 + `Idempotent-Replay: true`**, never a second resource.
A genuine conflict returns **409**.

Every entry `$inc`s its account's cache, so concurrent writes on the *same*
account genuinely conflict at the storage layer. MongoDB labels those
`TransientTransactionError` and `withTransaction` retries them — that is the
intended mechanism. The budget is 8 attempts (`utils/transaction.js`).

---

## 6. Operating it

```bash
npm run dev-replset        # single-node replica set on :27018 (transactions)
npm run check-replica-set  # is the configured MongoDB transaction-capable?
npm run reset-dev-db -- --yes --keep-rate   # clean start, rebuild indexes
npm test
```

Transactions require a **replica set** — a standalone `mongod` cannot run them
and every financial write will fail with `REPLICA_SET_REQUIRED`. See
`LOCAL_SETUP.md`.

`ensureFinancialIndexes()` runs at boot: the unique financial indexes are
load-bearing guarantees, and a transaction racing their lazy background build
sees spurious write conflicts.

**The nightly verifier** (`ledgerVerifier.service.js`) replays every account and
compares it to its cache. A mismatch is always a bug — it is logged loudly and
auto-repaired. `POST /admin/ledger/accounts/:id/rebuild-balance` is the manual
counterpart.

---

## 7. API surface

| Method | Route | Actor |
|---|---|---|
| `POST` | `/warehouse/payments` | warehouse |
| `POST` | `/warehouse/payments/:id/reverse` | warehouse — reason required |
| `GET` | `/warehouse/balances` | warehouse — ledger-backed account list |
| `GET` | `/warehouse/balances/:pharmacyId` | warehouse — statement + payments |
| `GET` | `/warehouse/settlement?from=&to=` | warehouse — commission owed, net |
| `GET` | `/warehouse/returns/:id/credit-preview` | warehouse — read-only |
| `POST` | `/warehouse/returns/:id/approve` | warehouse — posts the credit |
| `GET` | `/warehouse/orders/:id/invoice` | warehouse — includes commission/net |
| `GET` | `/pharmacy/debts` | pharmacy — debt / credit / net + accounts |
| `GET` | `/pharmacy/debts/:warehouseId` | pharmacy — statement |
| `GET` | `/orders/:id/invoice` | pharmacy — no commission on this copy |
| `GET` | `/orders/savings-summary` | pharmacy — 4-component breakdown |
| `POST` | `/admin/ledger/adjustments` | **admin only** — reason required |
| `POST` | `/admin/ledger/adjustments/:entryId/reverse` | admin — reason required |
| `POST` | `/admin/ledger/accounts/:accountId/rebuild-balance` | admin |
| `GET` | `/admin/exchange-rate/history` | admin |
| `GET` | `/admin/commission/overview?from=&to=` | **admin only** — every warehouse, most-owing first |
| `GET` | `/admin/commission/warehouses/:id?from=&to=` | admin — breakdown + collection history |
| `POST` | `/admin/commission/collections` | admin — records that a warehouse paid |
| `POST` | `/admin/commission/collections/:id/reverse` | admin — reason required |

Removed in V2: `PATCH /warehouse/payments/:id`, `DELETE /warehouse/payments/:id`.

---

## 8. Commission: owed vs. collected

Two different relationships, kept apart on purpose:

```
pharmacy  ──owes──▶  warehouse      LedgerAccount + LedgerEntry (the ledger)
warehouse ──owes──▶  platform       settlement report + CommissionCollection
```

**Owed is derived, collected is stored.** `settlement.service.js` recomputes
what a warehouse owes from the frozen fields on its delivered orders every
time it is asked, so the figure can never go stale or disagree with the
orders behind it. A collection is the only piece of commission state that is
written down, because *"someone handed over money"* is a fact no computation
can derive.

```
commissionOwedSyp    = settlement.totals.netCommissionSyp   (after return clawback)
alreadyCollectedSyp  = Σ recorded collections whose period OVERLAPS the range
outstandingSyp       = commissionOwedSyp − alreadyCollectedSyp
```

`outstandingSyp` is **not clamped**: a negative means the warehouse has over-
paid, or paid for a wider window than the one being viewed. Hiding that would
make an overpayment look like a settled account.

A `CommissionCollection` deliberately **posts no LedgerEntry**. A
LedgerAccount is the pharmacy↔warehouse receivable; putting commission into
it would corrupt the one number the ledger exists to keep honest. It also
carries no transaction, CAS or idempotency key — unlike the pharmacy paths,
this is an admin typing one bookkeeping row, where a duplicate is visible in
the history and reversible. It *is* audited (`commission.collected` /
`commission.collection_reversed`), and reversal requires a reason, like every
other correction here.

Admin-only end to end — a warehouse sees `/warehouse/settlement`, its own
position and nothing else. Pinned in `test/commission.collection.test.js`.

---

## 9. What V1 got wrong

Kept as a record of *why* the model looks like this — each of these is now
pinned by a test.

| Defect | Fix |
|---|---|
| Balance re-divided all history by **today's** rate, so a settled account drifted into a phantom credit whenever the lira moved | Per-event frozen FX (§2.2) |
| Payments freely editable and hard-deletable, no trail | Append-only + reversal + audit log |
| Returns moved no money — a pharmacy that handed goods back kept the full bill | `return_credit` (§4) |
| No transactions anywhere; balance recompute had a lost-update race | One transaction per money path |
| Duplicate order / payment / return-approval possible | Idempotency keys + CAS |
| Platform discount computed on the catalog sum, so a $40 package netted the warehouse $36.65 (8.4%) | Discount on the package price (§3) |
| Commission charged on pre-discount revenue, and read by nothing | On `finalPrice`, surfaced in Settlement, and collectable (§8) |
| "Money Saved" omitted package + platform savings and drifted with the rate | 4 components, frozen SYP |
| Pharmacy debt total silently dropped credit balances | debt / credit / net, server-computed |
| Invoice printed the undiscounted unit price beside a discounted line total | Discounted unit price is the headline |
| Return window: 24h in code, "48 hours" in every UI string | Aligned to 24h everywhere |
