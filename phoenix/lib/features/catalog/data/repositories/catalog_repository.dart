import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/features/catalog/data/models/category_model.dart';
import 'package:phoenix/features/catalog/data/models/manufacturer_model.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

abstract class CatalogRepository {
  Future<List<CategoryModel>> getCategories();

  // Cursor pagination: `after` is the previous page's nextCursor, omitted
  // for the first page. A text `search` returns every match at once (no
  // pagination) - see product.service.js, results are bounded by nature.
  Future<PaginatedResult<ProductModel>> getProducts({
    required String warehouseId,
    String? search,
    String? categoryId,
    String? manufacturer,
    int? limit,
    String? after,
  });

  // The pharmacist's entry point into a warehouse's catalog: distinct
  // manufacturers (manufacturerAr) with at least one product in this
  // warehouse, each carrying the warehouse's standing discount for it - see
  // product.service.js's listManufacturersWithDiscountsForWarehouse.
  Future<List<ManufacturerModel>> getManufacturers({required String warehouseId});
}
