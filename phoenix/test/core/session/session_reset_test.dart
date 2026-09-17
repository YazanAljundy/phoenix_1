import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/constants/storage_keys.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/core/services/auth_event_bus.dart';
import 'package:feniq/core/services/fcm_service.dart';
import 'package:feniq/core/services/secure_storage_service.dart';
import 'package:feniq/core/session/session_scope.dart';
import 'package:feniq/features/auth/data/models/auth_response.dart';
import 'package:feniq/features/auth/data/models/me_response.dart';
import 'package:feniq/features/auth/data/models/user_model.dart';
import 'package:feniq/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:feniq/features/auth/presentation/managers/auth_cubit.dart';
import 'package:feniq/features/auth/presentation/managers/auth_state.dart';
import 'package:feniq/features/cart/data/models/cart_item.dart';
import 'package:feniq/features/cart/data/models/order_model.dart';
import 'package:feniq/features/cart/data/repositories/order_repository.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/catalog/data/models/product_model.dart';
import 'package:feniq/features/notifications/data/repositories/notification_repository.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_list_result.dart';
import 'package:feniq/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:feniq/features/warehouse_selection/data/repositories/warehouse_repository.dart';
import 'package:feniq/features/warehouse_selection/presentation/managers/warehouse_selection_cubit.dart';
import 'package:feniq/features/warehouse_selection/presentation/managers/warehouse_selection_state.dart';

// The real AuthCubit, CartCubit and WarehouseSelectionCubit, wired through
// one SessionScope exactly as main.dart wires them. Only the repositories,
// storage and FCM are fakes.

class _MockAuthRepository extends Mock implements AuthRepositoryImpl {}

class _MockSecureStorage extends Mock implements SecureStorageService {}

class _MockFcmService extends Mock implements FcmService {}

class _MockNotificationRepository extends Mock implements NotificationRepository {}

class _MockOrderRepository extends Mock implements OrderRepository {}

class _MockWarehouseRepository extends Mock implements WarehouseRepository {}

UserModel _user(String id) => UserModel(
  id: id,
  name: 'Dr. $id',
  phone: '+963999999999',
  role: 'pharmacy',
  status: 'active',
  lang: 'ar',
);

ProductModel _product(String id) => ProductModel(
  id: id,
  nameAr: 'دواء $id',
  manufacturerAr: 'شركة',
  priceUsd: 10,
  discountPriceUsd: 10,
  isAvailable: true,
  hasActiveOffer: false,
);

WarehouseModel _warehouse(String id) =>
    WarehouseModel(id: id, nameAr: 'مستودع $id', nameEn: 'Warehouse $id', city: 'Latakia', phone: '0940000000');

const _order = OrderModel(
  id: 'o1',
  orderNumber: 1,
  status: 'pending',
  totalPrice: 0,
  discountAmount: 0,
  commissionAmount: 0,
  finalPrice: 0,
);

void main() {
  // AuthCubit._goToLogin touches NavigationService's GlobalKey, which needs a
  // binding. There is no navigator here, so it simply doesn't navigate.
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    registerFallbackValue(<CartItem>[]);
  });

  late _MockAuthRepository authRepo;
  late _MockSecureStorage storage;
  late _MockFcmService fcm;
  late _MockNotificationRepository notifications;
  late _MockOrderRepository orderRepo;
  late _MockWarehouseRepository warehouseRepo;
  late SessionScope scope;
  late AuthCubit auth;
  late CartCubit cart;
  late WarehouseSelectionCubit warehouses;

  void stubSubmit(Future<OrderModel> Function() answer) {
    when(
      () => orderRepo.submitOrder(
        warehouseId: any(named: 'warehouseId'),
        items: any(named: 'items'),
        notes: any(named: 'notes'),
        idempotencyKey: any(named: 'idempotencyKey'),
      ),
    ).thenAnswer((_) => answer());
  }

  List<String> sentKeys() => verify(
    () => orderRepo.submitOrder(
      warehouseId: any(named: 'warehouseId'),
      items: any(named: 'items'),
      notes: any(named: 'notes'),
      idempotencyKey: captureAny(named: 'idempotencyKey'),
    ),
  ).captured.cast<String>();

  setUp(() {
    authRepo = _MockAuthRepository();
    storage = _MockSecureStorage();
    fcm = _MockFcmService();
    notifications = _MockNotificationRepository();
    orderRepo = _MockOrderRepository();
    warehouseRepo = _MockWarehouseRepository();

    when(() => storage.delete(any())).thenAnswer((_) async {});
    when(() => storage.write(any(), any())).thenAnswer((_) async {});
    when(() => fcm.initialize()).thenAnswer((_) async {});
    when(() => fcm.unregisterDevice()).thenAnswer((_) async {});
    when(() => notifications.clear()).thenAnswer((_) async {});
    // The order-limits lookup the cart fires on its own; silent on failure by
    // design, and not what these tests are about.
    when(() => warehouseRepo.getWarehouseProfile(any())).thenAnswer((_) async => throw Exception('not exercised'));
    when(() => warehouseRepo.getWarehouses(onlyMyCity: true)).thenAnswer(
      (_) async => WarehouseListResult(warehouses: [_warehouse('w1')], cityFilterApplied: true),
    );
    when(() => warehouseRepo.getWarehouses(onlyMyCity: false)).thenAnswer(
      (_) async => WarehouseListResult(warehouses: [_warehouse('w1'), _warehouse('w2')], cityFilterApplied: false),
    );
    // The first submit never gets an answer, so the cart keeps its key.
    stubSubmit(() async => throw ServerFailure('No Internet Connection', code: FailureCode.network));

    scope = SessionScope();
    auth = AuthCubit(
      authRepository: authRepo,
      secureStorage: storage,
      fcmService: fcm,
      notificationRepository: notifications,
      sessionScope: scope,
    );
    cart = CartCubit(orderRepository: orderRepo, warehouseRepository: warehouseRepo, sessionScope: scope);
    warehouses = WarehouseSelectionCubit(warehouseRepository: warehouseRepo, sessionScope: scope);
  });

  tearDown(() async {
    await cart.close();
    await warehouses.close();
    await auth.close();
  });

  // Signed in as pharmacy A, with everything a session accumulates: a
  // warehouse list widened to all cities, and a cart with notes and a pending
  // idempotency key (its first submit got no answer).
  Future<void> signInAndFillSession() async {
    when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'jwt-a');
    when(() => authRepo.getMe()).thenAnswer((_) async => MeResponse(user: _user('a')));
    await auth.checkSession();
    expect(auth.state.sessionStatus, SessionStatus.active);

    await warehouses.loadWarehouses();
    await warehouses.setOnlyMyCity(false);

    cart.addProduct(_product('p1'), warehouseId: 'w1', warehouseName: 'Warehouse w1', quantity: 2);
    cart.updateNotes('leave at the back door');
    await cart.submitOrder();

    expect(cart.state.items, hasLength(1));
    expect(cart.state.pendingIdempotencyKey, isNotNull);
    expect(warehouses.state.status, WarehouseListStatus.loaded);
    expect(warehouses.state.onlyMyCity, isFalse);
    expect(warehouses.state.cityScopeAvailable, isTrue);
  }

  void expectCartReset() {
    final s = cart.state;
    expect(s.items, isEmpty);
    expect(s.warehouseId, isNull);
    expect(s.warehouseName, isNull);
    expect(s.notes, '');
    expect(s.minOrderAmountUsd, 0);
    expect(s.maxOrderAmountUsd, isNull);
    expect(s.isSubmitting, isFalse);
    expect(s.pendingIdempotencyKey, isNull);
    expect(s.errorCode, isNull);
    expect(s.errorMessage, isNull);
    expect(s.errorDetails, isNull);
  }

  void expectWarehousesReset() {
    final s = warehouses.state;
    expect(s.status, WarehouseListStatus.initial);
    expect(s.warehouses, isEmpty);
    // Back to the pharmacy's own city, with no toggle until the next
    // account's own list proves it has one.
    expect(s.onlyMyCity, isTrue);
    expect(s.cityFilterApplied, isFalse);
    expect(s.cityScopeAvailable, isFalse);
    expect(s.isChangingScope, isFalse);
    expect(s.errorCode, isNull);
  }

  void expectSessionKept() {
    expect(cart.state.items.single.productId, 'p1');
    expect(cart.state.warehouseId, 'w1');
    expect(cart.state.notes, 'leave at the back door');
    expect(cart.state.pendingIdempotencyKey, isNotNull);
    expect(warehouses.state.status, WarehouseListStatus.loaded);
    expect(warehouses.state.warehouses, hasLength(2));
    expect(warehouses.state.onlyMyCity, isFalse);
    expect(warehouses.state.cityScopeAvailable, isTrue);
  }

  group('a session that ends resets every session-scoped cubit', () {
    test('an explicit logout', () async {
      await signInAndFillSession();

      await auth.logout();

      expect(auth.state.sessionStatus, SessionStatus.unauthenticated);
      expectCartReset();
      expectWarehousesReset();
      // Still alongside the inbox, not instead of it.
      verify(() => notifications.clear()).called(1);
    });

    test('deleting the account', () async {
      await signInAndFillSession();
      when(() => authRepo.deleteAccount(password: any(named: 'password'))).thenAnswer((_) async {});

      final ok = await auth.deleteAccount(password: 'correct horse battery');

      expect(ok, isTrue);
      expectCartReset();
      expectWarehousesReset();
    });

    test('a 401 signalled on the bus (AuthInterceptor)', () async {
      await signInAndFillSession();

      AuthEventBus.instance.emitUnauthorized();
      await pumpEventQueue();

      expect(auth.state.sessionStatus, SessionStatus.unauthenticated);
      expectCartReset();
      expectWarehousesReset();
    });

    test('a 401 from the session check (GET /auth/me)', () async {
      await signInAndFillSession();
      when(() => authRepo.getMe()).thenThrow(ServerFailure('Unauthorized', statusCode: 401));

      await auth.checkSession(isResume: true);

      expect(auth.state.sessionStatus, SessionStatus.unauthenticated);
      expectCartReset();
      expectWarehousesReset();
    });

    test('the reset lands before `unauthenticated` is reported', () async {
      await signInAndFillSession();
      final seenWhenSignedOut = <bool>[];
      final sub = auth.stream.listen((s) {
        if (s.sessionStatus == SessionStatus.unauthenticated) {
          seenWhenSignedOut.add(cart.state.isEmpty && warehouses.state.warehouses.isEmpty);
        }
      });

      await auth.logout();
      await pumpEventQueue();
      await sub.cancel();

      expect(seenWhenSignedOut, [true]);
    });
  });

  group('signing in never clears anything', () {
    test('a successful password login', () async {
      await signInAndFillSession();
      when(() => authRepo.loginWithPassword(phone: any(named: 'phone'), password: any(named: 'password')))
          .thenAnswer((_) async => AuthResponse(token: 'jwt-a2', refreshToken: 'refresh', user: _user('a')));

      final ok = await auth.loginWithPassword(phone: '0999999999', password: 'right');

      expect(ok, isTrue);
      expect(auth.state.sessionStatus, SessionStatus.active);
      expectSessionKept();
      verifyNever(() => notifications.clear());
    });

    test('a failed login attempt (a wrong password is a refusal, not a sign-out)', () async {
      await signInAndFillSession();
      when(() => authRepo.loginWithPassword(phone: any(named: 'phone'), password: any(named: 'password')))
          .thenThrow(ServerFailure('Invalid credentials', code: 'INVALID_CREDENTIALS', statusCode: 401));

      final ok = await auth.loginWithPassword(phone: '0999999999', password: 'wrong');

      expect(ok, isFalse);
      expectSessionKept();
      verifyNever(() => storage.delete(any()));
    });

    test('a successful registration', () async {
      await signInAndFillSession();
      when(
        () => authRepo.register(
          name: any(named: 'name'),
          pharmacyName: any(named: 'pharmacyName'),
          phone: any(named: 'phone'),
          address: any(named: 'address'),
          areaType: any(named: 'areaType'),
          password: any(named: 'password'),
          latitude: any(named: 'latitude'),
          longitude: any(named: 'longitude'),
        ),
      ).thenAnswer((_) async => AuthResponse(token: 'jwt-a2', user: _user('a')));

      final ok = await auth.register(
        name: 'Dr. a',
        pharmacyName: 'Pharmacy a',
        phone: '0999999999',
        address: 'Latakia',
        areaType: 'city',
        password: 'a-long-password',
      );

      expect(ok, isTrue);
      expectSessionKept();
    });

    test('a session check that finds the session valid', () async {
      await signInAndFillSession();

      await auth.checkSession(isResume: true);

      expect(auth.state.sessionStatus, SessionStatus.active);
      expectSessionKept();
    });

    test('a session check that cannot reach the server', () async {
      await signInAndFillSession();
      when(() => authRepo.getMe()).thenThrow(ServerFailure('No Internet Connection', code: FailureCode.network));

      await auth.checkSession();

      expect(auth.state.sessionStatus, SessionStatus.offline);
      expectSessionKept();
    });
  });

  group('the cart idempotency key', () {
    test('a pending key is dropped by the reset, and the next submit carries a new one', () async {
      await signInAndFillSession();
      final keyBefore = cart.state.pendingIdempotencyKey!;

      await auth.logout();
      expect(cart.state.pendingIdempotencyKey, isNull);

      // The next account orders the very same thing: still a different key.
      stubSubmit(() async => _order);
      cart.addProduct(_product('p1'), warehouseId: 'w1', warehouseName: 'Warehouse w1', quantity: 2);
      cart.updateNotes('leave at the back door');
      await cart.submitOrder();

      final keys = sentKeys();
      expect(keys, hasLength(2));
      expect(keys.first, keyBefore);
      expect(keys.last, isNot(keyBefore));
    });
  });

  group('an answer for the previous account is dropped', () {
    test('a submit that succeeds after the switch leaves the next cart alone', () async {
      await signInAndFillSession();
      final answer = Completer<OrderModel>();
      stubSubmit(() => answer.future);
      final inFlight = cart.submitOrder();
      expect(cart.state.isSubmitting, isTrue);

      await auth.logout();
      expectCartReset();
      cart.addProduct(_product('p2'), warehouseId: 'w2', warehouseName: 'Warehouse w2', quantity: 1);
      answer.complete(_order);

      expect(await inFlight, isNull);
      expect(cart.state.items.single.productId, 'p2');
      expect(cart.state.warehouseId, 'w2');
      expect(cart.state.isSubmitting, isFalse);
    });

    test('a submit that is refused after the switch puts no error on the next cart', () async {
      await signInAndFillSession();
      final answer = Completer<OrderModel>();
      stubSubmit(() => answer.future);
      final inFlight = cart.submitOrder();

      await auth.logout();
      cart.addProduct(_product('p1'), warehouseId: 'w1', warehouseName: 'Warehouse w1', quantity: 2);
      answer.completeError(
        ServerFailure(
          'Price changed',
          code: 'PRICE_CHANGED',
          details: {
            'problems': [
              {'code': 'PRICE_CHANGED', 'productId': 'p1', 'displayedPriceUsd': 10, 'currentPriceUsd': 12},
            ],
          },
        ),
      );

      expect(await inFlight, isNull);
      expect(cart.state.errorCode, isNull);
      expect(cart.state.items.single.discountPriceUsd, 10);
      expect(cart.state.hasUnconfirmedPriceChanges, isFalse);
    });

    test('a warehouse list that arrives after the switch is not shown', () async {
      await signInAndFillSession();
      final answer = Completer<WarehouseListResult>();
      when(() => warehouseRepo.getWarehouses(onlyMyCity: false)).thenAnswer((_) => answer.future);
      final inFlight = warehouses.loadWarehouses();

      await auth.logout();
      answer.complete(WarehouseListResult(warehouses: [_warehouse('w-old')], cityFilterApplied: false));
      await inFlight;

      expectWarehousesReset();
    });
  });

  group('closed members', () {
    test('a closed cubit leaves the scope, and a sign-out afterwards does not fail', () async {
      expect(scope.memberCount, 2);

      await cart.close();
      expect(scope.memberCount, 1);

      await expectLater(auth.logout(), completes);
      expect(auth.state.sessionStatus, SessionStatus.unauthenticated);
      // A reset that still reaches a closed cubit is a no-op, not an error.
      expect(cart.resetForSignOut, returnsNormally);
      expectWarehousesReset();
    });
  });
}
