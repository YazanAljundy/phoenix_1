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
      final products = await _catalogRepository.getProducts(
        warehouseId: _warehouseId,
        manufacturer: _manufacturer,
      );
      emit(
        state.copyWith(
          status: CatalogStatus.loaded,
          categories: categories,
          products: products,
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

  Future<void> _reloadProducts() async {
    emit(state.copyWith(status: CatalogStatus.loading));
    try {
      final products = await _catalogRepository.getProducts(
        warehouseId: _warehouseId,
        manufacturer: _manufacturer,
        search: state.searchQuery.trim().isEmpty ? null : state.searchQuery.trim(),
        categoryId: state.selectedCategoryId,
      );
      emit(state.copyWith(status: CatalogStatus.loaded, products: products));
    } on Failure catch (f) {
      emit(state.copyWith(status: CatalogStatus.error, errorMessage: f.errMessage));
    }
  }

  @override
  Future<void> close() {
    _searchDebouncer.cancel();
    return super.close();
  }
}
