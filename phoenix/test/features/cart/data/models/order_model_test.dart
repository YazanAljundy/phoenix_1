import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';

// Focused on the optional delivery-seal-photo fields added to the order detail
// response - they must be backward compatible (absent -> false/null) and drive
// the `needsDeliverySealConfirmation` prompt the tracking screen shows.
Map<String, dynamic> _detailJson(Map<String, dynamic> overrides) => {
  'id': 'order-1',
  'orderNumber': 42,
  'status': 'out_for_delivery',
  'totalPrice': 1000,
  'discountAmount': 0,
  'commissionAmount': 0,
  'finalPrice': 1000,
  ...overrides,
};

void main() {
  group('OrderModel delivery seal photo', () {
    test('absent fields default to false / null (older server, older order)', () {
      final order = OrderModel.fromJson(_detailJson({}));
      expect(order.requiresDeliverySealPhoto, isFalse);
      expect(order.deliverySealPhotoUrl, isNull);
      expect(order.deliverySealConfirmedAt, isNull);
      expect(order.needsDeliverySealConfirmation, isFalse);
    });

    test('parses the fields when present', () {
      final order = OrderModel.fromJson(_detailJson({
        'requiresDeliverySealPhoto': true,
        'deliverySealPhoto': 'https://cdn/seal.jpg',
        'deliverySealConfirmedAt': '2026-09-04T10:00:00.000Z',
      }));
      expect(order.requiresDeliverySealPhoto, isTrue);
      expect(order.deliverySealPhotoUrl, 'https://cdn/seal.jpg');
      expect(order.deliverySealConfirmedAt, DateTime.parse('2026-09-04T10:00:00.000Z'));
    });

    test('needsDeliverySealConfirmation: out_for_delivery + required + no photo yet', () {
      final order = OrderModel.fromJson(_detailJson({'requiresDeliverySealPhoto': true}));
      expect(order.needsDeliverySealConfirmation, isTrue);
    });

    test('needsDeliverySealConfirmation is false once a photo is attached', () {
      final order = OrderModel.fromJson(_detailJson({
        'requiresDeliverySealPhoto': true,
        'deliverySealPhoto': 'https://cdn/seal.jpg',
      }));
      expect(order.needsDeliverySealConfirmation, isFalse);
    });

    test('needsDeliverySealConfirmation is false for other statuses even when required', () {
      for (final status in ['pending', 'confirmed', 'preparing', 'delivered']) {
        final order = OrderModel.fromJson(_detailJson({
          'status': status,
          'requiresDeliverySealPhoto': true,
        }));
        expect(order.needsDeliverySealConfirmation, isFalse, reason: status);
      }
    });

    test('copyWith preserves the seal fields', () {
      final order = OrderModel.fromJson(_detailJson({
        'requiresDeliverySealPhoto': true,
        'deliverySealPhoto': 'https://cdn/seal.jpg',
        'deliverySealConfirmedAt': '2026-09-04T10:00:00.000Z',
      }));
      final copy = order.copyWith();
      expect(copy.requiresDeliverySealPhoto, isTrue);
      expect(copy.deliverySealPhotoUrl, 'https://cdn/seal.jpg');
      expect(copy.deliverySealConfirmedAt, order.deliverySealConfirmedAt);
    });
  });
}
