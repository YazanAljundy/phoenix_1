import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/features/cart/data/models/order_line_item.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';
import 'package:phoenix/features/returns/presentation/managers/request_return_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/request_return_state.dart';

class MockReturnRepository extends Mock implements ReturnRepository {}

class MockOrderRepository extends Mock implements OrderRepository {}

OrderLineItem _line(String id) => OrderLineItem(
  id: id,
  productId: 'p_$id',
  productNameAr: 'دواء $id',
  manufacturerAr: 'شركة',
  quantity: 5,
  unitPrice: 100,
  discountPrice: 100,
  lineTotal: 500,
);

OrderModel _order(List<OrderLineItem> items) => OrderModel(
  id: 'o1',
  orderNumber: 1,
  status: 'delivered',
  totalPrice: 0,
  discountAmount: 0,
  commissionAmount: 0,
  finalPrice: 0,
  items: items,
);

ReturnModel _return() => ReturnModel(
  id: 'r1',
  orderId: 'o1',
  items: const [],
  status: 'pending',
  createdAt: DateTime(2026, 1, 1),
);

void main() {
  setUpAll(() {
    registerFallbackValue(<ReturnItemInput>[]);
    registerFallbackValue(<XFile>[]);
  });

  late MockReturnRepository returnRepo;
  late MockOrderRepository orderRepo;

  setUp(() {
    returnRepo = MockReturnRepository();
    orderRepo = MockOrderRepository();
    when(() => orderRepo.getOrder(any())).thenAnswer((_) async => _order([_line('a'), _line('b')]));
    when(
      () => returnRepo.createReturn(
        orderId: any(named: 'orderId'),
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        images: any(named: 'images'),
      ),
    ).thenAnswer((_) async => _return());
  });

  RequestReturnCubit build() => RequestReturnCubit(
    returnRepository: returnRepo,
    orderRepository: orderRepo,
    orderId: 'o1',
  );

  test('a return with items selected and NO photo is valid', () async {
    final cubit = build();
    await cubit.initialize();

    cubit.toggleItem('a');

    expect(cubit.state.newImages, isEmpty);
    expect(cubit.state.existingImageUrls, isEmpty);
    expect(cubit.isValid, isTrue, reason: 'the photo is optional');
    await cubit.close();
  });

  test('submit() without a photo calls createReturn with no images and succeeds', () async {
    final cubit = build();
    await cubit.initialize();
    cubit.toggleItem('a');
    cubit.setItemQuantity('a', 2);

    final result = await cubit.submit();

    expect(result, isNotNull);
    expect(cubit.state.status, RequestReturnStatus.submitted);
    final captured = verify(
      () => returnRepo.createReturn(
        orderId: 'o1',
        items: captureAny(named: 'items'),
        notes: any(named: 'notes'),
        images: captureAny(named: 'images'),
      ),
    ).captured;
    final items = captured[0] as List<ReturnItemInput>;
    final images = captured[1] as List<XFile>;
    expect(items.single.orderItemId, 'a');
    expect(items.single.quantity, 2);
    expect(images, isEmpty, reason: 'no MultipartFile is created when no photo was picked');
    await cubit.close();
  });

  test('submit() still forwards photos when the pharmacist picked some', () async {
    final cubit = build();
    await cubit.initialize();
    cubit.toggleItem('a');
    cubit.addImages([XFile('/tmp/photo1.jpg'), XFile('/tmp/photo2.jpg')]);

    await cubit.submit();

    final captured = verify(
      () => returnRepo.createReturn(
        orderId: 'o1',
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        images: captureAny(named: 'images'),
      ),
    ).captured;
    final images = captured.single as List<XFile>;
    expect(images.map((x) => x.path), ['/tmp/photo1.jpg', '/tmp/photo2.jpg']);
    await cubit.close();
  });

  test('no validation error is surfaced when submitting without a photo', () async {
    final cubit = build();
    await cubit.initialize();
    cubit.toggleItem('a');

    await cubit.submit();

    expect(cubit.state.status, RequestReturnStatus.submitted);
    expect(cubit.state.errorMessage, isNull);
    expect(cubit.state.errorCode, isNull);
    await cubit.close();
  });

  test('an item with reason "other" but no text is still invalid (unrelated rule kept)', () async {
    final cubit = build();
    await cubit.initialize();
    cubit.toggleItem('a');
    cubit.setItemReasonType('a', 'other');

    expect(cubit.isValid, isFalse);

    cubit.setItemCustomReason('a', 'expired stock');
    expect(cubit.isValid, isTrue);
    await cubit.close();
  });
}
