const { Schema, model } = require('mongoose');

// Section 15 (follow-up): a warehouse's manufacturer registry, populated by
// Excel imports (see warehouseProduct.service.js's importProductsFromExcel)
// - unlike deriving the list live from current products, this is
// deliberately sticky: a manufacturer registered once stays here even after
// every one of its products is later removed, so the Discounts tab's
// dropdown (manufacturerDiscount.service.js) doesn't lose an option just
// because inventory temporarily has none of that manufacturer's items.
const warehouseManufacturerSchema = new Schema(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    manufacturerAr: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

warehouseManufacturerSchema.index({ warehouseId: 1, manufacturerAr: 1 }, { unique: true });

module.exports = model('WarehouseManufacturer', warehouseManufacturerSchema);
