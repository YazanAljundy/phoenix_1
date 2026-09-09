import 'package:feniq/features/warehouse_selection/data/models/warehouse_model.dart';

/// One page of the warehouses list, plus what the server actually did to it.
///
/// [cityFilterApplied] is deliberately not the same thing as "the app asked
/// for the city scope". A pharmacy whose own `city` isn't usable gets the
/// full, unfiltered list back (see the backend's warehouse.service.js), and
/// the screen has to know that so it never labels an unfiltered list as
/// "my city" or offers a toggle that would do nothing.
class WarehouseListResult {
  const WarehouseListResult({
    required this.warehouses,
    required this.cityFilterApplied,
    this.pharmacyCity,
  });

  final List<WarehouseModel> warehouses;

  /// Whether the server really narrowed this list to the pharmacy's city.
  final bool cityFilterApplied;

  /// The pharmacy's own city as stored, or null when it has none the server
  /// could filter on. Only ever used as a presence check - the UI labels the
  /// scope with a localized "My city", never with this raw string, because
  /// it's stored in one language regardless of the app's locale.
  final String? pharmacyCity;

  /// Tolerant of a response from a backend that predates the city scope: the
  /// two flags simply read as "no filter was applied", which is exactly what
  /// such a backend did.
  factory WarehouseListResult.fromJson(Map<String, dynamic> json) {
    final warehouses = (json['warehouses'] as List).cast<Map<String, dynamic>>();
    return WarehouseListResult(
      warehouses: warehouses.map(WarehouseModel.fromJson).toList(),
      cityFilterApplied: json['cityFilterApplied'] as bool? ?? false,
      pharmacyCity: json['pharmacyCity'] as String?,
    );
  }
}
