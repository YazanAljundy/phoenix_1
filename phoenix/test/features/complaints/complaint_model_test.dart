import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';

Map<String, dynamic> payload({
  String? contextType = 'warehouse',
  String status = 'pending',
  Object? adminResponse,
  Object? respondedBy,
  Object? relatedOrderNumber,
  bool withWarehouse = true,
}) => {
  'id': 'c1',
  'complaintNumber': 42,
  if (contextType != null) 'contextType': contextType,
  'subject': 'Late delivery',
  'description': 'The order arrived two days late.',
  'extraDetails': null,
  'status': status,
  'relatedOrderId': relatedOrderNumber == null ? null : 'o1',
  'relatedOrderNumber': relatedOrderNumber,
  'adminResponse': adminResponse,
  'respondedAt': adminResponse == null ? null : '2026-08-20T09:00:00.000Z',
  'respondedBy': respondedBy,
  'createdAt': '2026-08-18T08:00:00.000Z',
  'updatedAt': '2026-08-20T09:00:00.000Z',
  if (withWarehouse)
    'warehouse': {
      'id': 'w1',
      'nameAr': 'مستودع النجاح',
      'nameEn': 'Al-Najah',
      'phone': '0911111111',
      'city': 'Latakia',
      'address': 'Main St',
      'logo': null,
    },
};

void main() {
  test('parses a warehouse-context complaint with no response', () {
    final complaint = ComplaintModel.fromJson(payload());
    expect(complaint.id, 'c1');
    expect(complaint.complaintNumber, 42);
    expect(complaint.context, ComplaintContext.warehouse);
    expect(complaint.isWarehouseContext, isTrue);
    expect(complaint.hasResponse, isFalse);
    expect(complaint.warehouse?.nameEn, 'Al-Najah');
    expect(complaint.respondedByName, isNull);
  });

  test('parses a resolved order-context complaint with an admin response', () {
    final complaint = ComplaintModel.fromJson(payload(
      contextType: 'order',
      status: 'resolved',
      adminResponse: 'We refunded the delivery fee.',
      respondedBy: {'id': 'a1', 'name': 'Support Team'},
      relatedOrderNumber: 91001,
    ));
    expect(complaint.context, ComplaintContext.order);
    expect(complaint.isOrderContext, isTrue);
    expect(complaint.isResolved, isTrue);
    expect(complaint.hasResponse, isTrue);
    expect(complaint.adminResponse, 'We refunded the delivery fee.');
    expect(complaint.respondedByName, 'Support Team');
    expect(complaint.relatedOrderNumber, 91001);
  });

  test('a general complaint carries no warehouse and no order', () {
    final complaint = ComplaintModel.fromJson(
      payload(contextType: 'general', withWarehouse: false),
    );
    expect(complaint.context, ComplaintContext.general);
    expect(complaint.isGeneral, isTrue);
    expect(complaint.warehouse, isNull);
    expect(complaint.relatedOrderNumber, isNull);
  });

  test('derives the context when contextType is absent (older payload)', () {
    expect(
      ComplaintModel.fromJson(payload(contextType: null, withWarehouse: false)).context,
      ComplaintContext.general,
    );
    expect(
      ComplaintModel.fromJson(payload(contextType: null)).context,
      ComplaintContext.warehouse,
    );
    expect(
      ComplaintModel.fromJson(payload(contextType: null, relatedOrderNumber: 5)).context,
      ComplaintContext.order,
    );
  });
}
