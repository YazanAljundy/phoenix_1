// Section 6.4: warehouse cards only need logo, name, city, and a visible
// fixed phone number - keep the payload to exactly that.
function serializeWarehouse(warehouse) {
  return {
    id: warehouse._id,
    nameAr: warehouse.nameAr,
    nameEn: warehouse.nameEn,
    city: warehouse.city,
    phone: warehouse.phone,
    logo: warehouse.logo,
  };
}

function toWarehouseListResponse(warehouses) {
  return { warehouses: warehouses.map(serializeWarehouse) };
}

module.exports = { toWarehouseListResponse };
