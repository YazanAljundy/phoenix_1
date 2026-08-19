// `canEdit` is computed here, not stored - canEditUntil is a fixed instant
// set at creation (payment.service.js), so "is it still editable" is only
// ever true relative to the moment of the request.
function serializePayment(payment) {
  return {
    id: payment._id,
    pharmacyId: payment.pharmacyId,
    warehouseId: payment.warehouseId,
    amount: payment.amount,
    currency: payment.currency,
    note: payment.note,
    recordedBy: payment.recordedBy,
    canEditUntil: payment.canEditUntil,
    canEdit: payment.canEditUntil > new Date(),
    createdAt: payment.createdAt,
  };
}

function toPaymentResponse(payment) {
  return { payment: serializePayment(payment) };
}

module.exports = { serializePayment, toPaymentResponse };
