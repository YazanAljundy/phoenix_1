// A recorded payment can always be edited or deleted by the warehouse that
// owns it - there is no time window, so no `canEdit` flag to compute.
function serializePayment(payment) {
  return {
    id: payment._id,
    pharmacyId: payment.pharmacyId,
    warehouseId: payment.warehouseId,
    amount: payment.amount,
    currency: payment.currency,
    note: payment.note,
    recordedBy: payment.recordedBy,
    createdAt: payment.createdAt,
  };
}

function toPaymentResponse(payment) {
  return { payment: serializePayment(payment) };
}

module.exports = { serializePayment, toPaymentResponse };
