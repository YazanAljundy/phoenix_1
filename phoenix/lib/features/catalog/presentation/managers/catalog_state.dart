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
    this.hasMore = false,
    this.nextCursor,
    this.isLoadingMore = false,
    this.loadMoreErrorMessage,
  });

  final CatalogStatus status;
  final List<CategoryModel> categories;
  final List<ProductModel> products;
  final String? selectedCategoryId;
  final String searchQuery;
  final String? errorMessage;

  // Cursor pagination - reset (hasMore: false, nextCursor: null) whenever
  // the manufacturer (fixed per screen instance, never changes), category,
  // or search query changes, since any of those restarts the result set
  // from its own first page. `isLoadingMore`/`loadMoreErrorMessage` are
  // deliberately separate from `status`/`errorMessage` above - a failed or
  // in-flight next-page fetch must never blank out the page(s) already
  // loaded and showing.
  final bool hasMore;
  final String? nextCursor;
  final bool isLoadingMore;
  final String? loadMoreErrorMessage;

  CatalogState copyWith({
    CatalogStatus? status,
    List<CategoryModel>? categories,
    List<ProductModel>? products,
    String? selectedCategoryId,
    bool clearCategory = false,
    String? searchQuery,
    String? errorMessage,
    bool? hasMore,
    String? nextCursor,
    bool clearNextCursor = false,
    bool? isLoadingMore,
    String? loadMoreErrorMessage,
    bool clearLoadMoreError = false,
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
      hasMore: hasMore ?? this.hasMore,
      nextCursor: clearNextCursor ? null : (nextCursor ?? this.nextCursor),
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      loadMoreErrorMessage: clearLoadMoreError ? null : (loadMoreErrorMessage ?? this.loadMoreErrorMessage),
    );
  }
}
