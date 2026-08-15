function serializeCategory(category) {
  return {
    id: category._id,
    nameAr: category.nameAr,
    nameEn: category.nameEn,
    icon: category.icon,
    sortOrder: category.sortOrder,
  };
}

function toCategoryListResponse(categories) {
  return { categories: categories.map(serializeCategory) };
}

module.exports = { toCategoryListResponse };
