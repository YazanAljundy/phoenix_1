// Money-Flow V2. The invoice for one delivered order.
//
// Not a stored document: every field resolves to a value frozen on the order,
// its line items, or the ledger entries raised against it. Re-rendering it a
// year later - or after the exchange rate has moved - produces the identical
// figures, which is the whole point of an invoice.
function toInvoiceResponse({ order, items, charge, credits, totalCreditSyp, netInvoiceSyp }, viewerRole) {
  return {
    invoice: {
      invoiceNumber: order.invoiceNumber ?? null,
      invoiceDate: order.deliveredAt ?? null,
      orderId: order._id,
      orderNumber: order.orderNumber,
      currency: order.currency ?? 'SYP',
      // The rate the order was priced through, kept so the USD figures on this
      // document are explainable rather than merely asserted.
      exchangeRate: order.fx?.rate ?? null,
      items: items.map((item) => ({
        productNameAr: item.productNameAr,
        productNameEn: item.productNameEn,
        manufacturerAr: item.manufacturerAr,
        manufacturerEn: item.manufacturerEn,
        quantity: item.quantity,
        // The DISCOUNTED unit price is the headline, with the original beside
        // it. V1 printed the original as the unit price next to a discounted
        // line total, so the two never multiplied out and the invoice looked
        // like it had an arithmetic error.
        unitPriceSyp: item.discountPrice,
        originalUnitPriceSyp: item.unitPrice,
        lineTotalSyp: item.discountPrice * item.quantity,
        savingsSyp: item.savingsSyp ?? 0,
      })),
      subtotalSyp: order.totalPrice,
      platformDiscountSyp: order.discountAmount,
      advertisementDiscountSyp: order.advertisementDiscountAmount ?? 0,
      finalAmountSyp: order.finalPrice,
      finalAmountUsd: order.finalAmountUsd ?? null,
      // Returns credited against this invoice, and what it nets to.
      credits: credits.map((credit) => ({
        entryNumber: credit.entryNumber,
        amountSyp: credit.amountSyp,
        amountUsd: credit.amountUsd,
        effectiveAt: credit.effectiveAt,
        returnId: credit.source?.returnId ?? null,
      })),
      totalCreditSyp,
      netInvoiceSyp,
      // Platform-internal: shown to the warehouse (it is what they net), never
      // on the pharmacy's copy.
      commissionSyp: viewerRole === 'warehouse' ? order.commissionAmount : undefined,
      warehouseNetSyp:
        viewerRole === 'warehouse' ? order.finalPrice - order.commissionAmount : undefined,
      chargeEntryNumber: charge ? charge.entryNumber : null,
    },
  };
}

module.exports = { toInvoiceResponse };
