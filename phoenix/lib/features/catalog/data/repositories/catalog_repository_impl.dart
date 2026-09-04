import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/catalog/data/models/category_model.dart';
import 'package:phoenix/features/catalog/data/models/manufacturer_model.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

import 'catalog_repository.dart';

class CatalogRepositoryImpl implements CatalogRepository {
  CatalogRepositoryImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  @override
  Future<List<CategoryModel>> getCategories() async {
    try {
      final response = await _apiClient.dio.get(Endpoints.categories);
      final data = response.data as Map<String, dynamic>;
      final categories = (data['categories'] as List).cast<Map<String, dynamic>>();
      return categories.map(CategoryModel.fromJson).toList();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<PaginatedResult<ProductModel>> getProducts({
    required String warehouseId,
    String? search,
    String? categoryId,
    String? manufacturer,
    int? limit,
    String? after,
  }) async {
    try {
      final response = await _apiClient.dio.get(
        Endpoints.warehouseProducts(warehouseId),
        queryParameters: {
          if (search != null && search.isNotEmpty) 'search': search,
          if (categoryId != null) 'categoryId': categoryId,
          if (manufacturer != null) 'manufacturer': manufacturer,
          if (limit != null) 'limit': limit,
          if (after != null) 'after': after,
        },
      );
      final data = response.data as Map<String, dynamic>;
      return PaginatedResult.fromJson(data, 'products', ProductModel.fromJson);
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<List<ManufacturerModel>> getManufacturers({required String warehouseId}) async {
    try {
      final response = await _apiClient.dio.get(Endpoints.warehouseManufacturers(warehouseId));
      final data = response.data as Map<String, dynamic>;
      return (data['manufacturers'] as List).map(ManufacturerModel.fromJson).toList();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
