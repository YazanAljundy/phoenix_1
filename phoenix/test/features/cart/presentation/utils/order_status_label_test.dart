import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/presentation/utils/order_status_label.dart';
import 'package:phoenix/generated/app_localizations.dart';

// The order status flow terminology (user-facing):
//   pending -> Sent, confirmed -> Waiting for Approval, preparing -> Preparing,
//   out_for_delivery -> On the Way, delivered -> Delivered.
// The internal order.status values are unchanged - only the labels.
void main() {
  late AppLocalizations en;
  late AppLocalizations ar;

  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
    ar = await AppLocalizations.delegate.load(const Locale('ar'));
  });

  group('orderStatusLabel - English', () {
    test('maps every stored status to its new stage name', () {
      expect(orderStatusLabel(en, 'pending'), 'Sent');
      expect(orderStatusLabel(en, 'confirmed'), 'Waiting for Approval');
      expect(orderStatusLabel(en, 'preparing'), 'Preparing');
      expect(orderStatusLabel(en, 'out_for_delivery'), 'On the Way');
      expect(orderStatusLabel(en, 'delivered'), 'Delivered');
      expect(orderStatusLabel(en, 'cancelled'), 'Cancelled');
    });

    test('no label still uses the retired terminology', () {
      for (final status in ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered']) {
        expect(orderStatusLabel(en, status), isNot(anyOf('Under review', 'Out for delivery')));
      }
    });
  });

  group('orderStatusLabel - Arabic', () {
    test('maps every stored status to its new stage name', () {
      expect(orderStatusLabel(ar, 'pending'), 'تم الإرسال');
      expect(orderStatusLabel(ar, 'confirmed'), 'بانتظار الموافقة');
      expect(orderStatusLabel(ar, 'preparing'), 'قيد التحضير');
      expect(orderStatusLabel(ar, 'out_for_delivery'), 'بالطريق');
      expect(orderStatusLabel(ar, 'delivered'), 'تم التسليم');
    });
  });

  group('orderStatusDescription', () {
    test('the four active stages have a user-facing description (EN + AR)', () {
      expect(orderStatusDescription(en, 'confirmed'), 'Your order has reached the warehouse');
      expect(orderStatusDescription(en, 'preparing'), 'The warehouse is preparing your order');
      expect(orderStatusDescription(en, 'out_for_delivery'), 'Your order has left the warehouse');
      expect(orderStatusDescription(en, 'delivered'), 'You received the order');

      expect(orderStatusDescription(ar, 'confirmed'), 'وصل طلبك إلى المستودع');
      expect(orderStatusDescription(ar, 'preparing'), 'المستودع عم يجهز طلبك');
      expect(orderStatusDescription(ar, 'out_for_delivery'), 'طلبك طلع من المستودع');
      expect(orderStatusDescription(ar, 'delivered'), 'استلمت الطلب');
    });

    test('Sent / cancelled / unknown carry no description', () {
      expect(orderStatusDescription(en, 'pending'), isNull);
      expect(orderStatusDescription(en, 'cancelled'), isNull);
      expect(orderStatusDescription(en, 'modified'), isNull);
    });
  });

  group('the tracked stage order is unchanged (5 stages, 1:1 with stored status)', () {
    test('kOrderTrackedStages still drives the progress bar index', () {
      expect(kOrderTrackedStages, ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered']);
      final order = OrderModel(
        id: '1',
        orderNumber: 1,
        status: 'out_for_delivery',
        totalPrice: 0,
        discountAmount: 0,
        commissionAmount: 0,
        finalPrice: 0,
      );
      expect(order.stageIndex, 3);
    });
  });
}
