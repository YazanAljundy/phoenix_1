// Carries the warehouse name (always) and an optional manufacturer to
// auto-navigate straight into (from a tapped banner - see BannerSlider) from
// WarehouseSelectionView/WarehouseProfileView to ManufacturersView, passed
// as the go_router `extra`. Mirrors CatalogRouteArgs' role one screen over.
class ManufacturersRouteArgs {
  const ManufacturersRouteArgs({required this.warehouseName, this.autoFilterManufacturer});

  final String warehouseName;
  final String? autoFilterManufacturer;
}
