import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/order_tracking/presentation/managers/order_tracking_cubit.dart';
import 'package:feniq/features/reviews/data/repositories/review_repository.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_list_result.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';

class MockOrderRepository extends Mock implements OrderRepository {}

class MockReviewRepository extends Mock implements ReviewRepository {}

class MockWarehouseRepository extends Mock implements WarehouseRepository {}

OrderModel _order({String? sealUrl}) => OrderModel(
  id: 'o1',
  orderNumber: 1,
  status: 'out_for_delivery',
  totalPrice: 1000,
  discountAmount: 0,
  commissionAmount: 0,
  finalPrice: 1000,
  requiresDeliverySealPhoto: true,
  deliverySealPhotoUrl: sealUrl,
  deliverySealConfirmedAt: sealUrl == null ? null : DateTime(2026, 9, 4),
);

void main() {
  setUpAll(() {
    registerFallbackValue(XFile('fallback.jpg'));
  });

  late MockOrderRepository orderRepo;
  late MockReviewRepository reviewRepo;
  late MockWarehouseRepository warehouseRepo;

  setUp(() {
    orderRepo = MockOrderRepository();
    reviewRepo = MockReviewRepository();
    warehouseRepo = MockWarehouseRepository();
    when(() => warehouseRepo.getWarehouses(onlyMyCity: any(named: 'onlyMyCity'))).thenAnswer(
      (_) async => const WarehouseListResult(warehouses: [], cityFilterApplied: false),
    );
  });

  OrderTrackingCubit build() => OrderTrackingCubit(
    orderRepository: orderRepo,
    reviewRepository: reviewRepo,
    warehouseRepository: warehouseRepo,
    orderId: 'o1',
  );

  test('confirmDelivery: on success the order is patched with the server copy', () async {
    when(
      () => orderRepo.confirmDeliveryWithSealPhoto(
        orderId: any(named: 'orderId'),
        sealPhoto: any(named: 'sealPhoto'),
      ),
    ).thenAnswer((_) async => _order(sealUrl: 'https://cdn/seal.jpg'));

    final cubit = build();
    final ok = await cubit.confirmDelivery(XFile('seal.jpg'));

    expect(ok, isTrue);
    expect(cubit.state.isConfirmingDelivery, isFalse);
    expect(cubit.state.order?.deliverySealPhotoUrl, 'https://cdn/seal.jpg');
    expect(cubit.state.errorMessage, isNull);
  });

  test('confirmDelivery: on a Failure the error surfaces and the order is untouched', () async {
    when(
      () => orderRepo.confirmDeliveryWithSealPhoto(
        orderId: any(named: 'orderId'),
        sealPhoto: any(named: 'sealPhoto'),
      ),
    ).thenThrow(ServerFailure('required', code: 'DELIVERY_SEAL_PHOTO_REQUIRED'));

    final cubit = build();
    final ok = await cubit.confirmDelivery(XFile('seal.jpg'));

    expect(ok, isFalse);
    expect(cubit.state.isConfirmingDelivery, isFalse);
    expect(cubit.state.errorCode, 'DELIVERY_SEAL_PHOTO_REQUIRED');
    expect(cubit.state.order, isNull);
  });
}
