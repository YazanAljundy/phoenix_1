// The pharmacist's entry into a warehouse's catalog: one distinct
// manufacturer (its Arabic name - also the exact string the catalog filters
// on) paired with the warehouse's standing discount for that manufacturer,
// so the company card can show it. See the backend's
// listManufacturersWithDiscountsForWarehouse - the discount here is
// display-only, every price the app renders stays server-computed.
class ManufacturerModel {
  const ManufacturerModel({required this.name, this.discountPercentage = 0});

  // The manufacturer's Arabic name - the only name the backend's distinct
  // query produces, and the value CatalogView filters the medicine list on.
  final String name;
  // Warehouse-set, always-on discount for this manufacturer's products, as a
  // percentage. 0 when the warehouse has configured none - the card shows
  // "0%", it never hides the company.
  final num discountPercentage;

  // Accepts either the enriched object shape or a bare name string (an older
  // backend, or mid-rollout) - a plain string just carries no discount info,
  // i.e. 0.
  factory ManufacturerModel.fromJson(Object? json) {
    if (json is String) return ManufacturerModel(name: json);
    final map = json as Map<String, dynamic>;
    return ManufacturerModel(
      name: map['manufacturerAr'] as String,
      discountPercentage: (map['discountPercentage'] as num?) ?? 0,
    );
  }
}
