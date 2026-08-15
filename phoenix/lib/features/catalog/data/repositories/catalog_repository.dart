import 'package:phoenix/features/catalog/data/models/category_model.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

abstract class CatalogRepository {
  Future<List<CategoryModel>> getCategories();

  Future<List<ProductModel>> getProducts({
    required String warehouseId,
    String? search,
    String? categoryId,
  });
}
