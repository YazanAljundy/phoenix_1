const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const LedgerEntry = require('../models/ledgerEntry.model');
const Counter = require('../models/counter.model');
const ledger = require('./ledger.service');
const financialAudit = require('./financialAudit.service');

// Money-Flow V2. The bridge between an order's lifecycle and the ledger.
//
// Exactly one thing in an order's life moves money: the transition to
// `delivered`. Everything before it is free to change; everything after it is
// corrected by posting further ledger entries, never by editing the order.

const INVOICE_NUMBER_COUNTER_ID = 'invoice_number';

async function nextInvoiceNumber(session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: INVOICE_NUMBER_COUNTER_ID },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  );
  return counter.seq;
}

// The frozen pricing breakdown copied onto the charge entry, so a statement or
// an invoice can render the line without re-reading the order, and a dispute
// years later sees exactly the figures that were charged.
function chargeMetadata(order) {
  return {
    orderNumber: order.orderNumber,
    invoiceNumber: order.invoiceNumber,
    subtotalSyp: order.totalPrice,
    platformDiscountSyp: order.discountAmount,
    advertisementDiscountSyp: order.advertisementDiscountAmount ?? 0,
    commissionSyp: order.commissionAmount,
    finalAmountSyp: order.finalPrice,
    advertisementId: order.advertisementId ?? null,
  };
}

// Posts the one `charge` a delivered order produces.
//
// Idempotent by construction: the existing-charge lookup makes a retry cheap,
// and the unique partial index on LedgerEntry (source.orderId, kind='charge')
// makes a *concurrent* retry impossible rather than merely unlikely. Either
// way a second call returns the charge that already exists instead of billing
// the pharmacy twice.
//
// Must run inside the same transaction as the status change itself, so an
// order can never be delivered without its charge (or vice versa).
async function postChargeForDelivery({ order, userId, deliveredAt, account = null }, session) {
  const existing = await LedgerEntry.findOne({
    'source.orderId': order._id,
    kind: 'charge',
  }).session(session);
  if (existing) {
    return { entry: existing, alreadyPosted: true };
  }

  // The caller normally resolves the account BEFORE opening the transaction:
  // creating it is an upsert, and an upsert that has to create the collection
  // (or trip Mongoose's lazy background index build) inside a transaction
  // raises write conflicts that get retried until the attempt budget runs out.
  // Resolving it first is harmless - an account is just a container, and
  // resolveAccount is idempotent.
  const resolved = account ?? (await ledger.resolveAccount(order.pharmacyId, order.warehouseId, session));

  // Assigned here rather than at order creation: an invoice number is a claim
  // that something was actually invoiced, and a pending or cancelled order
  // never is. Never reused, so the sequence has gaps only where a delivery was
  // later reversed - which is the honest shape.
  if (!order.invoiceNumber) {
    order.invoiceNumber = await nextInvoiceNumber(session);
  }
  order.deliveredAt = deliveredAt;

  const { entry } = await ledger.postEntry(
    {
      account: resolved,
      kind: 'charge',
      amountSyp: order.finalPrice,
      amountUsd: order.finalAmountUsd,
      // The order's OWN frozen rate - the one its lines were priced through -
      // not whatever the rate happens to be on the day it is delivered.
      fx: order.fx,
      effectiveAt: deliveredAt,
      source: { orderId: order._id },
      createdBy: userId,
      metadata: chargeMetadata(order),
    },
    session
  );

  order.chargeEntryId = entry._id;

  return { entry, alreadyPosted: false };
}

// Undoes a charge for an order that was marked delivered but never actually
// was. Deliberately NOT a normal action: it needs an elevated actor and a
// reason, and it leaves both the original charge and its reversal in the
// history. The invoice number is kept (marked void by the order flag) rather
// than freed - a number that changes meaning is worse than a gap.
async function reverseChargeForOrder({ order, userId, reason }, session) {
  const charge = await LedgerEntry.findOne({
    'source.orderId': order._id,
    kind: 'charge',
  }).session(session);
  if (!charge) {
    return { entry: null, reversed: false };
  }

  const { entry } = await ledger.postReversal(
    { targetEntry: charge, createdBy: userId, reason, source: { orderId: order._id } },
    session
  );
  return { entry, reversed: true };
}

// The invoice a delivered order represents: its frozen snapshot, its frozen
// line items, and any return credits raised against it. Every field resolves
// to a stored value, so re-rendering it a year later - or after the exchange
// rate has moved - produces the identical document.
async function buildInvoice(order) {
  const [items, charge, credits] = await Promise.all([
    OrderItem.find({ orderId: order._id })
      .select('productNameAr productNameEn manufacturerAr manufacturerEn quantity unitPrice discountPrice savingsSyp savingsUsd')
      .lean(),
    LedgerEntry.findOne({ 'source.orderId': order._id, kind: 'charge' }).lean(),
    // Credits are linked to their return, and the return's metadata carries
    // the order - so this finds every credit raised against this invoice.
    LedgerEntry.find({ kind: 'return_credit', 'metadata.orderId': order._id }).lean(),
  ]);

  const totalCreditSyp = credits.reduce((sum, credit) => sum + credit.amountSyp, 0);

  return {
    order,
    items,
    charge,
    credits,
    totalCreditSyp,
    netInvoiceSyp: order.finalPrice - totalCreditSyp,
  };
}

// Convenience for the delivery path: records the audit trail for a posted
// charge. Kept beside the posting itself so the two never drift.
async function auditDelivery({ order, entry, userId, alreadyPosted }, session) {
  if (alreadyPosted) return null;
  return financialAudit.record(
    {
      action: 'order.delivered',
      actorId: userId,
      actorRole: 'warehouse',
      entityType: 'Order',
      entityId: order._id,
      accountId: entry.accountId,
      ledgerEntryIds: [entry._id],
      after: {
        status: 'delivered',
        invoiceNumber: order.invoiceNumber,
        chargeSyp: entry.amountSyp,
      },
    },
    session
  );
}

module.exports = {
  postChargeForDelivery,
  reverseChargeForOrder,
  buildInvoice,
  auditDelivery,
  nextInvoiceNumber,
  chargeMetadata,
};
