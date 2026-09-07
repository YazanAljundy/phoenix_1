// Money-Flow V2. A payment is append-only: there is no edit and no delete, so
// there is no `canEdit` flag to compute. What the client needs instead is the
// lifecycle - whether this row is a settlement or a reversal, whether it has
// been reversed, and by/for which other payment.
function serializePayment(payment) {
  return {
    id: payment._id,
    paymentNumber: payment.paymentNumber ?? null,
    pharmacyId: payment.pharmacyId,
    warehouseId: payment.warehouseId,
    // What was actually tendered, in the currency it was tendered in.
    amount: payment.amount,
    currency: payment.currency,
    // The settled value in both currencies, frozen at record time. amountSyp
    // is the figure that moved the ledger; neither is ever re-derived from a
    // later exchange rate.
    amountSyp: payment.amountSyp ?? null,
    amountUsd: payment.amountUsd ?? null,
    exchangeRate: payment.fx?.rate ?? null,
    method: payment.method ?? null,
    reference: payment.reference ?? null,
    paidAt: payment.paidAt ?? payment.createdAt,
    note: payment.note,
    recordedBy: payment.recordedBy,
    // Lifecycle - drives whether the panel offers a "Reverse" action and how
    // the row is rendered (a reversed settlement is struck through and linked
    // to the reversal that undid it).
    kind: payment.kind ?? 'settlement',
    status: payment.status ?? 'posted',
    reversesPaymentId: payment.reversesPaymentId ?? null,
    reversedByPaymentId: payment.reversedByPaymentId ?? null,
    reversalReason: payment.reversalReason ?? null,
    ledgerEntryId: payment.ledgerEntryId ?? null,
    createdAt: payment.createdAt,
  };
}

function toPaymentResponse(payment) {
  return { payment: serializePayment(payment) };
}

module.exports = { serializePayment, toPaymentResponse };
