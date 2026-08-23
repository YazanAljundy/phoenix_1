import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/utils/debouncer.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository.dart';

import 'catalog_state.dart';

class CatalogCubit extends Cubit<CatalogState> {
  CatalogCubit({
    required CatalogRepository catalogRepository,
    required String warehouseId,
    required String manufacturer,
  }) : _catalogRepository = catalogRepository,
       _warehouseId = warehouseId,
       _manufacturer = manufacturer,
       super(const CatalogState());

  final CatalogRepository _catalogRepository;
  final String _warehouseId;
  // Section 16: the catalog is now always scoped to one manufacturer, chosen
  // on ManufacturersView just before this screen - never cleared from here.
  final String _manufacturer;
  final Debouncer _searchDebouncer = Debouncer(duration: const Duration(milliseconds: 400));

  Future<void> initialize() async {
    emit(state.copyWith(status: CatalogStatus.loading));
    try {
      final categories = await _catalogRepository.getCategories();
      final result = await _catalogRepository.getProducts(
        warehouseId: _warehouseId,
        manufacturer: _manufacturer,
      );
      emit(
        state.copyWith(
          status: CatalogStatus.loaded,
          categories: categories,
          products: result.items,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
        ),
      );
    } on Failure catch (f) {
      emit(state.copyWith(status: CatalogStatus.error, errorMessage: f.errMessage));
    }
  }

  void search(String query) {
    emit(state.copyWith(searchQuery: query));
    _searchDebouncer.run(_reloadProducts);
  }

  void selectCategory(String? categoryId) {
    emit(
      state.copyWith(selectedCategoryId: categoryId, clearCategory: categoryId == null),
    );
    _reloadProducts();
  }

  // Manufacturer/search/category all restart pagination from page one - the
  // cursor from the previous filter combination means nothing under a new
  // one, so it's never carried over here.
  Future<void> _reloadProducts() async {
    emit(state.copyWith(status: CatalogStatus.loading, hasMore: false, clearNextCursor: true));
    try {
      final result = await _catalogRepository.getProducts(
        warehouseId: _warehouseId,
        manufacturer: _manufacturer,
        search: state.searchQuery.trim().isEmpty ? null : state.searchQuery.trim(),
        categoryId: state.selectedCategoryId,
      );
      emit(
        state.copyWith(
          status: CatalogStatus.loaded,
          products: result.items,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
        ),
      );
    } on Failure catch (f) {
      emit(state.copyWith(status: CatalogStatus.error, errorMessage: f.errMessage));
    }
  }

  // Called as the product grid/list nears its end. A text search returns
  // every match up front (hasMore is always false for it, see the
  // repository) so this never has anything to do in that case.
  Future<void> loadMore() async {
    if (!state.hasMore || state.isLoadingMore || state.nextCursor == null) return;

    emit(state.copyWith(isLoadingMore: true, clearLoadMoreError: true));
    try {
      final result = await _catalogRepository.getProducts(
        warehouseId: _warehouseId,
        manufacturer: _manufacturer,
        search: state.searchQuery.trim().isEmpty ? null : state.searchQuery.trim(),
        categoryId: state.selectedCategoryId,
        after: state.nextCursor,
      );
      emit(
        state.copyWith(
          products: [...state.products, ...result.items],
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          clearNextCursor: result.nextCursor == null,
          isLoadingMore: false,
        ),
      );
    } on Failure catch (f) {
      // The cursor/hasMore stay exactly as they were - a retry just repeats
      // this same call rather than needing any state to be rebuilt first.
      emit(state.copyWith(isLoadingMore: false, loadMoreErrorMessage: f.errMessage));
    }
  }

  @override
  Future<void> close() {
    _searchDebouncer.cancel();
    return super.close();
  }
}
