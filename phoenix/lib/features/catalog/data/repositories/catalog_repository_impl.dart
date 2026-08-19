import 'package:dio/dio.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/catalog/data/models/category_model.dart';
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
  Future<List<ProductModel>> getProducts({
    required String warehouseId,
    String? search,
    String? categoryId,
    String? manufacturer,
  }) async {
    try {
      final response = await _apiClient.dio.get(
        Endpoints.warehouseProducts(warehouseId),
        queryParameters: {
          if (search != null && search.isNotEmpty) 'search': search,
          if (categoryId != null) 'categoryId': categoryId,
          if (manufacturer != null) 'manufacturer': manufacturer,
        },
      );
      final data = response.data as Map<String, dynamic>;
      final products = (data['products'] as List).cast<Map<String, dynamic>>();
      return products.map(ProductModel.fromJson).toList();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }

  @override
  Future<List<String>> getManufacturers({required String warehouseId}) async {
    try {
      final response = await _apiClient.dio.get(Endpoints.warehouseManufacturers(warehouseId));
      final data = response.data as Map<String, dynamic>;
      return (data['manufacturers'] as List).cast<String>();
    } on DioException catch (e) {
      throw ServerFailure.fromDioError(e);
    }
  }
}
