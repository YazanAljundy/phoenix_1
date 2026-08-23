// Shared shape for the cursor-paginated list endpoints (products, orders,
// returns) - `nextCursor` is only meaningful when `hasMore` is true, and is
// always the raw string a caller passes back as `after` for the next page,
// regardless of what field the backend actually cursors on underneath.
class PaginatedResult<T> {
  const PaginatedResult({required this.items, required this.hasMore, this.nextCursor});

  final List<T> items;
  final bool hasMore;
  final String? nextCursor;

  factory PaginatedResult.fromJson(
    Map<String, dynamic> json,
    String itemsKey,
    T Function(Map<String, dynamic>) fromJsonT,
  ) {
    final pagination = json['pagination'] as Map<String, dynamic>?;
    return PaginatedResult(
      items: (json[itemsKey] as List).map((e) => fromJsonT(e as Map<String, dynamic>)).toList(),
      hasMore: pagination?['hasMore'] as bool? ?? false,
      nextCursor: pagination?['nextCursor'] as String?,
    );
  }
}
