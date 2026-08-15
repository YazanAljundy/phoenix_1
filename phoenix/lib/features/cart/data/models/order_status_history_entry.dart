class OrderStatusHistoryEntry {
  const OrderStatusHistoryEntry({required this.status, required this.changedAt});

  final String status;
  final DateTime changedAt;

  factory OrderStatusHistoryEntry.fromJson(Map<String, dynamic> json) => OrderStatusHistoryEntry(
    status: json['status'] as String,
    changedAt: DateTime.parse(json['changedAt'] as String),
  );
}
