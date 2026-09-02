const WarehouseManufacturer = require('../models/warehouseManufacturer.model');

// Registers every manufacturer discovered in an Excel import (Section 15
// follow-up) - upsert only, so a manufacturer that stops appearing in a
// later import is never removed. Safe to call with duplicates in the list.
async function registerManufacturers(warehouseId, manufacturerNames) {
  await Promise.all(
    manufacturerNames.map((manufacturerAr) =>
      WarehouseManufacturer.findOneAndUpdate(
        { warehouseId, manufacturerAr },
        { $setOnInsert: { warehouseId, manufacturerAr } },
        { upsert: true }
      )
    )
  );
}

async function listManufacturersForWarehouse(warehouseId) {
  // Only the manufacturer name is read out of each row.
  const rows = await WarehouseManufacturer.find({ warehouseId })
    .select('manufacturerAr')
    .sort({ manufacturerAr: 1 });
  return rows.map((row) => row.manufacturerAr);
}

module.exports = { registerManufacturers, listManufacturersForWarehouse };
