function serializeDiscount(discount) {
  return {
    id: discount._id,
    manufacturerAr: discount.manufacturerAr,
    discountPercentage: discount.discountPercentage,
    createdAt: discount.createdAt,
  };
}

function toDiscountResponse(discount) {
  return { discount: serializeDiscount(discount) };
}

function toDiscountListResponse(discounts) {
  return { discounts: discounts.map(serializeDiscount) };
}

module.exports = { toDiscountResponse, toDiscountListResponse };
