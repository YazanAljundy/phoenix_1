import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/returns/data/models/returnable_order_model.dart';

// The server decides eligibility and the hours left; these tests pin the
// parsing and the one piece of display logic the client owns (isEndingSoon).
Map<String, dynamic> payload({int hoursRemaining = 40, List<Map<String, dynamic>>? items}) => {
  'id': 'o1',
  'orderNumber': 1042,
  'warehouseId': 'w1',
  'warehouseNameAr': 'مستودع النجاح',
  'warehouseNameEn': 'Al-Najah',
  'finalPrice': 125000,
  'deliveredAt': '2026-08-25T10:00:00.000Z',
  'hoursRemaining': hoursRemaining,
  'items': items ??
      [
        {
          'orderItemId': 'oi1',
          'productId': 'p1',
          'productNameAr': 'باراسيتامول',
          'productNameEn': 'Paracetamol',
          'quantity': 2,
          'discountPrice': 500,
        },
      ],
};

void main() {
  test('parses the full server payload', () {
    final order = ReturnableOrderModel.fromJson(payload());
    expect(order.id, 'o1');
    expect(order.orderNumber, 1042);
    expect(order.warehouseNameAr, 'مستودع النجاح');
    expect(order.finalPrice, 125000);
    expect(order.hoursRemaining, 40);
    expect(order.deliveredAt.toUtc().hour, 10);
    expect(order.items.single.productNameAr, 'باراسيتامول');
    expect(order.items.single.quantity, 2);
  });

  test('a null English product name is tolerated (Arabic-only catalog rows)', () {
    final order = ReturnableOrderModel.fromJson(payload(items: [
      {
        'orderItemId': 'oi1',
        'productId': 'p1',
        'productNameAr': 'دواء',
        'productNameEn': null,
        'quantity': 1,
        'discountPrice': 100,
      },
    ]));
    expect(order.items.single.productNameEn, isNull);
    expect(order.items.single.productNameAr, 'دواء');
  });

  group('isEndingSoon', () {
    test('is false with 12 hours or more left', () {
      expect(ReturnableOrderModel.fromJson(payload(hoursRemaining: 12)).isEndingSoon, isFalse);
      expect(ReturnableOrderModel.fromJson(payload(hoursRemaining: 48)).isEndingSoon, isFalse);
    });

    test('is true under 12 hours', () {
      expect(ReturnableOrderModel.fromJson(payload(hoursRemaining: 11)).isEndingSoon, isTrue);
      expect(ReturnableOrderModel.fromJson(payload(hoursRemaining: 1)).isEndingSoon, isTrue);
    });
  });
}
