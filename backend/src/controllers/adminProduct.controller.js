const { asyncHandler } = require('../utils/asyncHandler');
const adminProductService = require('../services/adminProduct.service');
const adminProductViewModel = require('../viewmodels/adminProduct.viewmodel');

const list = asyncHandler(async (req, res) => {
  const rows = await adminProductService.listAllProducts();
  res.json({ success: true, ...adminProductViewModel.toAdminProductListResponse(rows) });
});

const update = asyncHandler(async (req, res) => {
  const product = await adminProductService.updateProduct(req.params.id, req.user._id, req.body);
  res.json({
    success: true,
    message: 'Product updated.',
    ...adminProductViewModel.toAdminProductResponse(product),
  });
});

const deactivate = asyncHandler(async (req, res) => {
  await adminProductService.deactivateProduct(req.params.id);
  res.json({ success: true, message: 'Product removed.' });
});

module.exports = { list, update, deactivate };
