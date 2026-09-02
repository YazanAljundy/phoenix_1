import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';
import 'package:phoenix/features/complaints/data/models/submit_complaint_args.dart';
import 'package:phoenix/features/complaints/data/repositories/complaint_repository.dart';
import 'package:phoenix/features/complaints/presentation/managers/my_complaints_cubit.dart';
import 'package:phoenix/features/complaints/presentation/managers/my_complaints_state.dart';
import 'package:phoenix/features/complaints/presentation/managers/submit_complaint_cubit.dart';
import 'package:phoenix/features/complaints/presentation/managers/submit_complaint_state.dart';

class MockComplaintRepository extends Mock implements ComplaintRepository {}

class FakeComplaintInput extends Fake implements ComplaintInput {}

ComplaintModel _complaint(String id, {String status = 'pending'}) => ComplaintModel(
  id: id,
  complaintNumber: 1,
  context: ComplaintContext.general,
  subject: 'Subject $id',
  description: 'Description $id',
  status: status,
  createdAt: DateTime.utc(2026, 8, 18),
  updatedAt: DateTime.utc(2026, 8, 18),
);

void main() {
  setUpAll(() => registerFallbackValue(FakeComplaintInput()));

  group('MyComplaintsCubit', () {
    late MockComplaintRepository repo;

    setUp(() => repo = MockComplaintRepository());

    test('load populates the list and pagination flags', () async {
      when(() => repo.getComplaints(after: any(named: 'after'))).thenAnswer(
        (_) async => PaginatedResult(
          items: [_complaint('c1'), _complaint('c2')],
          hasMore: true,
          nextCursor: 'cursor-1',
        ),
      );
      final cubit = MyComplaintsCubit(complaintRepository: repo);

      await cubit.load();

      expect(cubit.state.status, MyComplaintsStatus.loaded);
      expect(cubit.state.complaints, hasLength(2));
      expect(cubit.state.hasMore, isTrue);
      expect(cubit.state.nextCursor, 'cursor-1');
      await cubit.close();
    });

    test('loadMore appends the next page', () async {
      when(() => repo.getComplaints(after: null)).thenAnswer(
        (_) async => PaginatedResult(items: [_complaint('c1')], hasMore: true, nextCursor: 'c1'),
      );
      when(() => repo.getComplaints(after: 'c1')).thenAnswer(
        (_) async => PaginatedResult(items: [_complaint('c2')], hasMore: false, nextCursor: null),
      );
      final cubit = MyComplaintsCubit(complaintRepository: repo);

      await cubit.load();
      await cubit.loadMore();

      expect(cubit.state.complaints.map((c) => c.id), ['c1', 'c2']);
      expect(cubit.state.hasMore, isFalse);
      await cubit.close();
    });

    test('a load failure surfaces the error without crashing', () async {
      when(() => repo.getComplaints(after: any(named: 'after')))
          .thenThrow(ServerFailure('boom', code: 'HTTP_500'));
      final cubit = MyComplaintsCubit(complaintRepository: repo);

      await cubit.load();

      expect(cubit.state.status, MyComplaintsStatus.error);
      expect(cubit.state.errorCode, 'HTTP_500');
      await cubit.close();
    });
  });

  group('SubmitComplaintCubit - context decides the payload (no picker)', () {
    late MockComplaintRepository repo;

    setUp(() => repo = MockComplaintRepository());

    SubmitComplaintCubit build(SubmitComplaintArgs args) =>
        SubmitComplaintCubit(complaintRepository: repo, args: args);

    ComplaintInput lastInput() =>
        verify(() => repo.createComplaint(captureAny())).captured.single as ComplaintInput;

    test('starts ready with the context from the args - no warehouse loading', () {
      final general = build(const SubmitComplaintArgs.general());
      expect(general.state.status, SubmitComplaintStatus.ready);
      expect(general.state.context, ComplaintContext.general);

      final wh = build(const SubmitComplaintArgs.warehouse(warehouseId: 'w1', warehouseName: 'WH One'));
      expect(wh.state.context, ComplaintContext.warehouse);
      expect(wh.state.warehouseName, 'WH One');

      final order = build(const SubmitComplaintArgs.order(
        orderId: 'o1',
        orderNumber: 1042,
        orderWarehouseName: 'WH One',
      ));
      expect(order.state.context, ComplaintContext.order);
      expect(order.state.orderNumber, 1042);
      expect(order.state.warehouseName, 'WH One');
    });

    test('isValid needs only a subject and a description', () {
      final cubit = build(const SubmitComplaintArgs.general());
      expect(cubit.state.isValid, isFalse);
      cubit.setSubject('  ');
      cubit.setDescription('details');
      expect(cubit.state.isValid, isFalse, reason: 'blank subject');
      cubit.setSubject('Feedback');
      expect(cubit.state.isValid, isTrue);
    });

    test('GENERAL: payload carries neither warehouseId nor relatedOrderId', () async {
      when(() => repo.createComplaint(any())).thenAnswer((_) async => _complaint('c1'));
      final cubit = build(const SubmitComplaintArgs.general());
      cubit.setSubject('  App feedback  ');
      cubit.setDescription('  search is slow  ');

      await cubit.submit();

      final input = lastInput();
      expect(input.subject, 'App feedback');
      expect(input.description, 'search is slow');
      expect(input.warehouseId, isNull);
      expect(input.relatedOrderId, isNull);
      expect(input.toJson().containsKey('warehouseId'), isFalse);
      expect(input.toJson().containsKey('relatedOrderId'), isFalse);
    });

    test('WAREHOUSE: payload carries warehouseId only', () async {
      when(() => repo.createComplaint(any())).thenAnswer((_) async => _complaint('c1'));
      final cubit = build(const SubmitComplaintArgs.warehouse(warehouseId: 'w1', warehouseName: 'WH'));
      cubit.setSubject('Late');
      cubit.setDescription('two days late');

      await cubit.submit();

      final input = lastInput();
      expect(input.warehouseId, 'w1');
      expect(input.relatedOrderId, isNull);
    });

    test('ORDER: payload carries relatedOrderId and NO warehouseId (Section 5)', () async {
      when(() => repo.createComplaint(any())).thenAnswer((_) async => _complaint('c1'));
      final cubit = build(const SubmitComplaintArgs.order(orderId: 'o1', orderNumber: 1042));
      cubit.setSubject('Missing item');
      cubit.setDescription('item X was missing');

      await cubit.submit();

      final input = lastInput();
      expect(input.relatedOrderId, 'o1');
      expect(input.warehouseId, isNull);
      expect(input.toJson().containsKey('warehouseId'), isFalse,
          reason: 'the client never sends a warehouse in order context');
    });

    test('the in-flight guard blocks a double-submit', () async {
      when(() => repo.createComplaint(any())).thenAnswer((_) async => _complaint('c1'));
      final cubit = build(const SubmitComplaintArgs.general());
      cubit.setSubject('s');
      cubit.setDescription('d');

      final results = await Future.wait([cubit.submit(), cubit.submit()]);

      expect(results.where((r) => r != null), hasLength(1));
      verify(() => repo.createComplaint(any())).called(1);
    });

    test('a submit failure exposes the backend error code', () async {
      when(() => repo.createComplaint(any()))
          .thenThrow(ServerFailure('nope', code: 'COMPLAINT_CONTEXT_MISMATCH'));
      final cubit = build(const SubmitComplaintArgs.order(orderId: 'o1', orderNumber: 1));
      cubit.setSubject('s');
      cubit.setDescription('d');

      final result = await cubit.submit();

      expect(result, isNull);
      expect(cubit.state.status, SubmitComplaintStatus.submitError);
      expect(cubit.state.errorCode, 'COMPLAINT_CONTEXT_MISMATCH');
    });
  });
}
