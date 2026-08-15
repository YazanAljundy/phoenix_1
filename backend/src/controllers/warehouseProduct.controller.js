const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const Warehouse = require('../models/warehouse.model');
const warehouseProductService = require('../services/warehouseProduct.service');
const warehouseProductViewModel = require('../viewmodels/warehouseProduct.viewmodel');

async function loadWarehouseOrThrow(userId) {
  const warehouse = await Warehouse.findOne({ userId });
  if (!warehouse) {
    throw ApiError.notFound('Warehouse profile not found.', 'WAREHOUSE_PROFILE_NOT_FOUND');
  }
  return warehouse;
}

const list = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const products = await warehouseProductService.listProductsForWarehouse(warehouse._id);
  res.json({ success: true, ...warehouseProductViewModel.toProductListResponse(products) });
});

const create = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const product = await warehouseProductService.createProduct(warehouse._id, req.body);
  res.status(201).json({
    success: true,
    message: 'Product created.',
    ...warehouseProductViewModel.toProductResponse(product),
  });
});

const update = asyncHandler(async (req, res) => {
  const warehouse = await loadWarehouseOrThrow(req.user._id);
  const product = await warehouseProductService.updateProduct(
    req.params.id,
    warehouse._id,
    req.user._id,
    req.body
  );
  res.json({
    success: true,
    message: 'Product updated.',
    ...warehouseProductViewModel.toProductResponse(product),
  });
});

module.exports = { list, create, update };
