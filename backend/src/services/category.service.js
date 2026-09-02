const Category = require('../models/category.model');

async function listCategories() {
  // .lean(): read-only reference data, straight into category.viewmodel.js.
  // .select(): serializeCategory emits id/nameAr/nameEn/icon/sortOrder and
  // nothing else - only the timestamps are dropped here.
  return Category.find()
    .select('nameAr nameEn icon sortOrder')
    .sort({ sortOrder: 1, nameEn: 1 })
    .lean();
}

module.exports = { listCategories };
