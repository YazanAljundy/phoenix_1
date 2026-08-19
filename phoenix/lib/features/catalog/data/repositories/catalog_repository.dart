import 'package:phoenix/features/catalog/data/models/category_model.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

abstract class CatalogRepository {
  Future<List<CategoryModel>> getCategories();

  Future<List<ProductModel>> getProducts({
    required String warehouseId,
    String? search,
    String? categoryId,
    String? manufacturer,
  });

  // The pharmacist's entry point into a warehouse's catalog: distinct
  // manufacturers (manufacturerAr) with at least one product in this
  // warehouse - see product.service.js's listDistinctManufacturersForWarehouse.
  Future<List<String>> getManufacturers({required String warehouseId});
}
