import 'package:phoenix/features/catalog/data/models/category_model.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';

enum CatalogStatus { initial, loading, loaded, error }

class CatalogState {
  const CatalogState({
    this.status = CatalogStatus.initial,
    this.categories = const [],
    this.products = const [],
    this.selectedCategoryId,
    this.searchQuery = '',
    this.errorMessage,
  });

  final CatalogStatus status;
  final List<CategoryModel> categories;
  final List<ProductModel> products;
  final String? selectedCategoryId;
  final String searchQuery;
  final String? errorMessage;

  CatalogState copyWith({
    CatalogStatus? status,
    List<CategoryModel>? categories,
    List<ProductModel>? products,
    String? selectedCategoryId,
    bool clearCategory = false,
    String? searchQuery,
    String? errorMessage,
  }) {
    return CatalogState(
      status: status ?? this.status,
      categories: categories ?? this.categories,
      products: products ?? this.products,
      selectedCategoryId: clearCategory
          ? null
          : (selectedCategoryId ?? this.selectedCategoryId),
      searchQuery: searchQuery ?? this.searchQuery,
      errorMessage: errorMessage,
    );
  }
}
