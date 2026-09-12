import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:feniq/core/constants/storage_keys.dart';
import 'package:feniq/core/network/endpoints.dart';
import 'package:feniq/core/network/interceptors/auth_interceptor.dart';
import 'package:feniq/core/services/auth_event_bus.dart';
import 'package:feniq/core/services/secure_storage_service.dart';

class MockSecureStorage extends Mock implements SecureStorageService {}

class MockDio extends Mock implements Dio {}

class MockErrorHandler extends Mock implements ErrorInterceptorHandler {}

class MockRequestHandler extends Mock implements RequestInterceptorHandler {}

RequestOptions _options(String path) => RequestOptions(path: path);

DioException _unauthorized(RequestOptions options) => DioException(
  requestOptions: options,
  type: DioExceptionType.badResponse,
  response: Response(requestOptions: options, statusCode: 401),
);

void main() {
  setUpAll(() {
    registerFallbackValue(_options('/fallback'));
    registerFallbackValue(
      Response<dynamic>(requestOptions: _options('/fallback')),
    );
    registerFallbackValue(
      DioException(requestOptions: _options('/fallback')),
    );
  });

  late MockSecureStorage storage;
  late MockDio retryClient;
  late MockDio refreshClient;
  late AuthInterceptor interceptor;
  late List<void> unauthorizedEvents;
  late StreamSubscription<void> subscription;

  AuthInterceptor build() => AuthInterceptor(
    secureStorage: storage,
    retryClient: retryClient,
    refreshClient: refreshClient,
  );

  // A successful POST /auth/refresh.
  void stubRefreshSucceeds({String token = 'new-access', String? refresh = 'new-refresh'}) {
    when(
      () => refreshClient.post(Endpoints.refresh, data: any(named: 'data')),
    ).thenAnswer(
      (_) async => Response(
        requestOptions: _options(Endpoints.refresh),
        statusCode: 200,
        data: {'token': token, if (refresh != null) 'refreshToken': refresh},
      ),
    );
  }

  setUp(() {
    storage = MockSecureStorage();
    retryClient = MockDio();
    refreshClient = MockDio();
    interceptor = build();

    when(() => storage.write(any(), any())).thenAnswer((_) async {});
    when(() => storage.delete(any())).thenAnswer((_) async {});
    when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => 'stale-access');
    when(() => storage.read(StorageKeys.refreshToken)).thenAnswer((_) async => 'stored-refresh');

    unauthorizedEvents = [];
    subscription = AuthEventBus.instance.onUnauthorized.listen(unauthorizedEvents.add);
  });

  tearDown(() async {
    await subscription.cancel();
  });

  group('onRequest attaches the stored access token', () {
    test('adds the Bearer header when a token is stored', () async {
      final options = _options('/orders');
      final handler = MockRequestHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onRequest(options, handler);

      expect(options.headers['Authorization'], 'Bearer stale-access');
    });

    test('sends no header at all when there is no token', () async {
      when(() => storage.read(StorageKeys.authToken)).thenAnswer((_) async => null);
      final options = _options('/orders');
      final handler = MockRequestHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('Authorization'), isFalse);
    });
  });

  group('a 401 refreshes and replays instead of logging out (F-03)', () {
    test('stores the new pair, replays the request, and stays signed in', () async {
      stubRefreshSucceeds();
      final options = _options('/orders');
      final replayed = Response(requestOptions: options, statusCode: 200, data: {'ok': true});
      when(() => retryClient.fetch<dynamic>(any())).thenAnswer((_) async => replayed);

      final handler = MockErrorHandler();
      when(() => handler.resolve(any())).thenReturn(null);

      await interceptor.onError(_unauthorized(options), handler);
      await pumpEventQueue();

      verify(() => storage.write(StorageKeys.authToken, 'new-access')).called(1);
      verify(() => storage.write(StorageKeys.refreshToken, 'new-refresh')).called(1);
      verify(() => handler.resolve(replayed)).called(1);
      expect(unauthorizedEvents, isEmpty, reason: 'the user must not be logged out');
    });

    test('the rotated refresh token is persisted, not just the access token', () async {
      // The backend consumes the refresh token on every use, so failing to
      // store the replacement would strand the session at the next expiry.
      stubRefreshSucceeds(refresh: 'rotated-once');
      when(
        () => retryClient.fetch<dynamic>(any()),
      ).thenAnswer((_) async => Response(requestOptions: _options('/orders'), statusCode: 200));

      final handler = MockErrorHandler();
      when(() => handler.resolve(any())).thenReturn(null);

      await interceptor.onError(_unauthorized(_options('/orders')), handler);

      verify(() => storage.write(StorageKeys.refreshToken, 'rotated-once')).called(1);
    });

    test('parallel 401s trigger exactly one refresh', () async {
      // Six requests from one screen all come back 401 together. Without
      // single-flight they would race, and rotation means five would spend an
      // already-consumed token and sign the user out.
      final refreshCompleter = Completer<Response<dynamic>>();
      when(
        () => refreshClient.post(Endpoints.refresh, data: any(named: 'data')),
      ).thenAnswer((_) => refreshCompleter.future);
      when(
        () => retryClient.fetch<dynamic>(any()),
      ).thenAnswer((_) async => Response(requestOptions: _options('/orders'), statusCode: 200));

      final handlers = List.generate(6, (_) {
        final handler = MockErrorHandler();
        when(() => handler.resolve(any())).thenReturn(null);
        return handler;
      });

      final pending = [
        for (var i = 0; i < handlers.length; i++)
          interceptor.onError(_unauthorized(_options('/orders/$i')), handlers[i]),
      ];
      await pumpEventQueue();

      refreshCompleter.complete(
        Response(
          requestOptions: _options(Endpoints.refresh),
          statusCode: 200,
          data: {'token': 'new-access', 'refreshToken': 'new-refresh'},
        ),
      );
      await Future.wait(pending);

      verify(
        () => refreshClient.post(Endpoints.refresh, data: any(named: 'data')),
      ).called(1);
      expect(unauthorizedEvents, isEmpty);
    });
  });

  group('a 401 only logs out when the refresh cannot save it', () {
    test('no stored refresh token -> signal once, and do not call refresh', () async {
      when(() => storage.read(StorageKeys.refreshToken)).thenAnswer((_) async => null);
      final handler = MockErrorHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onError(_unauthorized(_options('/orders')), handler);
      await pumpEventQueue();

      verifyNever(() => refreshClient.post(any(), data: any(named: 'data')));
      expect(unauthorizedEvents, hasLength(1));
      verify(() => handler.next(any())).called(1);
    });

    test('a rejected refresh token signals unauthorized', () async {
      when(
        () => refreshClient.post(Endpoints.refresh, data: any(named: 'data')),
      ).thenThrow(
        DioException(
          requestOptions: _options(Endpoints.refresh),
          response: Response(requestOptions: _options(Endpoints.refresh), statusCode: 401),
        ),
      );
      final handler = MockErrorHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onError(_unauthorized(_options('/orders')), handler);
      await pumpEventQueue();

      expect(unauthorizedEvents, hasLength(1));
    });

    test('the interceptor itself never deletes stored tokens', () async {
      // Clearing storage is AuthCubit's single logout flow. If the interceptor
      // also deleted, an offline refresh attempt would destroy a session that
      // was merely unreachable.
      when(
        () => refreshClient.post(Endpoints.refresh, data: any(named: 'data')),
      ).thenThrow(DioException(requestOptions: _options(Endpoints.refresh)));
      final handler = MockErrorHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onError(_unauthorized(_options('/orders')), handler);

      verifyNever(() => storage.delete(any()));
    });

    test('a replay that 401s again logs out rather than looping', () async {
      stubRefreshSucceeds();
      final options = _options('/orders');
      when(() => retryClient.fetch<dynamic>(any())).thenAnswer((invocation) async {
        final replayOptions = invocation.positionalArguments.first as RequestOptions;
        throw _unauthorized(replayOptions);
      });

      final handler = MockErrorHandler();
      when(() => handler.next(any())).thenReturn(null);
      await interceptor.onError(_unauthorized(options), handler);

      // The replay's own 401 comes back through onError carrying the retry
      // flag, which is what stops a second refresh.
      final retriedOptions = _options('/orders')..extra['feniq.authRetried'] = true;
      final secondHandler = MockErrorHandler();
      when(() => secondHandler.next(any())).thenReturn(null);
      await interceptor.onError(_unauthorized(retriedOptions), secondHandler);
      await pumpEventQueue();

      verify(
        () => refreshClient.post(Endpoints.refresh, data: any(named: 'data')),
      ).called(1);
      expect(unauthorizedEvents, isNotEmpty);
    });
  });

  group('errors that are not an expired session are passed straight through', () {
    test('a 401 from login is a wrong password, not a dead session', () async {
      final handler = MockErrorHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onError(_unauthorized(_options(Endpoints.loginPassword)), handler);
      await pumpEventQueue();

      verifyNever(() => refreshClient.post(any(), data: any(named: 'data')));
      expect(unauthorizedEvents, isEmpty);
      verify(() => handler.next(any())).called(1);
    });

    test('a 401 from the refresh endpoint does not recurse into itself', () async {
      final handler = MockErrorHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onError(_unauthorized(_options(Endpoints.refresh)), handler);
      await pumpEventQueue();

      verifyNever(() => refreshClient.post(any(), data: any(named: 'data')));
      expect(unauthorizedEvents, isEmpty);
    });

    test('a timeout never triggers a refresh or a logout', () async {
      final options = _options('/orders');
      final handler = MockErrorHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onError(
        DioException(requestOptions: options, type: DioExceptionType.connectionTimeout),
        handler,
      );
      await pumpEventQueue();

      verifyNever(() => refreshClient.post(any(), data: any(named: 'data')));
      expect(unauthorizedEvents, isEmpty);
    });

    test('a 500 never triggers a refresh or a logout', () async {
      final options = _options('/orders');
      final handler = MockErrorHandler();
      when(() => handler.next(any())).thenReturn(null);

      await interceptor.onError(
        DioException(
          requestOptions: options,
          type: DioExceptionType.badResponse,
          response: Response(requestOptions: options, statusCode: 500),
        ),
        handler,
      );
      await pumpEventQueue();

      verifyNever(() => refreshClient.post(any(), data: any(named: 'data')));
      expect(unauthorizedEvents, isEmpty);
    });
  });
}
