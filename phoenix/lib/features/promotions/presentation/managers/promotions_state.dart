import 'package:phoenix/features/promotions/data/models/promotion.dart';

enum PromotionsStatus { initial, loading, loaded, error }

/// Everything the Offers & Ads tab renders.
///
/// `promotions` is the full live list as the two endpoints returned it,
/// already ordered; the filters are applied here rather than stored as a
/// second list, so changing a filter never needs a refetch and can never drift
/// out of sync with what was loaded.
class PromotionsState {
  const PromotionsState({
    this.status = PromotionsStatus.initial,
    this.promotions = const [],
    this.kindFilter,
    this.warehouseFilter,
    this.errorMessage,
    this.errorCode,
  });

  final PromotionsStatus status;
  final List<Promotion> promotions;

  /// Null = both kinds.
  final PromotionKind? kindFilter;

  /// A warehouse id, or null for all warehouses.
  final String? warehouseFilter;

  // Kept raw rather than pre-rendered: only the View has the l10n needed to
  // turn a code into the right Arabic/English sentence (see
  // core/error/error_translator.dart).
  final String? errorMessage;
  final String? errorCode;

  bool get hasFilters => kindFilter != null || warehouseFilter != null;

  /// How many promotions are live in total, before any filter - what the app
  /// bar counts.
  int get totalCount => promotions.length;

  /// The list the screen actually shows.
  List<Promotion> get filtered {
    if (!hasFilters) return promotions;
    return promotions.where((promotion) {
      if (kindFilter != null && promotion.kind != kindFilter) return false;
      if (warehouseFilter != null && promotion.warehouseId != warehouseFilter) return false;
      return true;
    }).toList();
  }

  /// The carousel's cards: the deepest discounts among whatever is currently
  /// filtered in, so the hero always agrees with the list beneath it. Capped
  /// so the carousel stays a highlight rather than a second full list.
  static const int featuredLimit = 5;

  List<Promotion> get featured {
    final visible = filtered;
    return visible.length <= featuredLimit ? visible : visible.sublist(0, featuredLimit);
  }

  /// The warehouses worth offering in the filter - only those with something
  /// running, taken from the promotions themselves rather than a second fetch.
  /// Deliberately built off the unfiltered list so choosing a warehouse never
  /// removes the other warehouses from the picker.
  List<PromotionWarehouse> get warehouses {
    final byId = <String, PromotionWarehouse>{};
    for (final promotion in promotions) {
      byId.putIfAbsent(
        promotion.warehouseId,
        () => PromotionWarehouse(
          id: promotion.warehouseId,
          nameAr: promotion.warehouseName(true),
          nameEn: promotion.warehouseName(false),
        ),
      );
    }
    return byId.values.toList()..sort((a, b) => a.nameAr.compareTo(b.nameAr));
  }

  PromotionsState copyWith({
    PromotionsStatus? status,
    List<Promotion>? promotions,
    PromotionKind? kindFilter,
    bool clearKindFilter = false,
    String? warehouseFilter,
    bool clearWarehouseFilter = false,
    String? errorMessage,
    String? errorCode,
  }) {
    return PromotionsState(
      status: status ?? this.status,
      promotions: promotions ?? this.promotions,
      kindFilter: clearKindFilter ? null : (kindFilter ?? this.kindFilter),
      warehouseFilter: clearWarehouseFilter ? null : (warehouseFilter ?? this.warehouseFilter),
      errorMessage: errorMessage,
      errorCode: errorCode,
    );
  }
}
