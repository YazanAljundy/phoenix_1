extension DateTimeExtensions on DateTime {
  String get formattedShort => '$year-$month-$day';

  String get formattedLong =>
      '${day.toString().padLeft(2, '0')}/${month.toString().padLeft(2, '0')}/$year';
}
