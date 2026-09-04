// The warehouse's own view of its settings. discountRate/commissionRate are
// included read-only for reference (the admin sets those, not the warehouse
// - see admin.service.js's createWarehouseAccount).
function toWarehouseSettingsResponse(warehouse) {
  return {
    settings: {
      id: warehouse._id,
      nameAr: warehouse.nameAr,
      nameEn: warehouse.nameEn,
      city: warehouse.city,
      address: warehouse.address,
      phone: warehouse.phone,
      deliveryType: warehouse.deliveryType,
      deliveryStartTime: warehouse.deliveryStartTime,
      deliveryEndTime: warehouse.deliveryEndTime,
      discountRate: warehouse.discountRate,
      commissionRate: warehouse.commissionRate,
      minOrderAmountUsd: warehouse.minOrderAmountUsd,
      maxOrderAmountUsd: warehouse.maxOrderAmountUsd,
      // Opt-in proof-of-delivery toggle (warehouse.model.js). `?? false` for
      // documents that predate the field.
      requireDeliverySealPhoto: warehouse.requireDeliverySealPhoto ?? false,
    },
  };
}

module.exports = { toWarehouseSettingsResponse };
