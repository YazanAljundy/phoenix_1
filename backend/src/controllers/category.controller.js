const { asyncHandler } = require('../utils/asyncHandler');
const categoryService = require('../services/category.service');
const categoryViewModel = require('../viewmodels/category.viewmodel');

const list = asyncHandler(async (req, res) => {
  const categories = await categoryService.listCategories();
  res.json({ success: true, ...categoryViewModel.toCategoryListResponse(categories) });
});

module.exports = { list };
