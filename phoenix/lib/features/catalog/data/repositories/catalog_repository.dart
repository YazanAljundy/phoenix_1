import 'package:feniq/core/models/paginated_result.dart';
import 'package:feniq/features/catalog/data/models/category_model.dart';
import 'package:feniq/features/catalog/data/models/manufacturer_model.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';

abstract class CatalogRepository {
  Future<List<CategoryModel>> getCategories();

  // Cursor pagination: `after` is the previous page's nextCursor, omitted
  // for the first page. A text `search` paginates the same way - it used to
  // return every match at once, which a one- or two-letter query turns into
  // most of the catalog (see product.service.js).
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
