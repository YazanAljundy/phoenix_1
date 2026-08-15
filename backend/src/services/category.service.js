const Category = require('../models/category.model');

async function listCategories() {
  return Category.find().sort({ sortOrder: 1, nameEn: 1 });
}

module.exports = { listCategories };
