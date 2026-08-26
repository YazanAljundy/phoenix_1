import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/auth/data/repositories/auth_repository_impl.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockDio extends Mock implements Dio {}

void main() {
  late MockApiClient mockApiClient;
  late MockDio mockDio;
  late AuthRepositoryImpl authRepository;

  setUp(() {
    mockApiClient = MockApiClient();
    mockDio = MockDio();
    when(() => mockApiClient.dio).thenReturn(mockDio);
    authRepository = AuthRepositoryImpl(apiClient: mockApiClient);
  });

  group('AuthRepositoryImpl', () {
    group('sendOtp', () {
      test('calls API with correct phone number', () async {
        const phone = '+96393123456';
        when(() => mockDio.post(any(), data: any(named: 'data'))).thenAnswer(
          (_) async => Response(
            data: {},
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        await authRepository.sendOtp(phone);

        verify(
          () => mockDio.post(Endpoints.sendOtp, data: {'phone': phone}),
        ).called(1);
      });

      test('throws ServerFailure on DioException', () async {
        const phone = '+96393123456';
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.connectionTimeout,
        );

        when(
          () => mockDio.post(any(), data: any(named: 'data')),
        ).thenThrow(dioError);

        expect(
          () => authRepository.sendOtp(phone),
          throwsA(isA<ServerFailure>()),
        );
      });
    });

    group('register', () {
      test('returns AuthResponse on successful registration', () async {
        final responseData = {
          'token': 'auth_token',
          'user': {
            'id': 'user1',
            'name': 'John Doe',
            'phone': '+96393123456',
            'role': 'pharmacy',
            'status': 'pending',
            'lang': 'ar',
          },
          'pharmacy': {
            'id': 'pharm1',
            'nameAr': 'صيدليتي',
            'nameEn': 'My Pharmacy',
            'ownerName': 'John Doe',
            'address': 'Main St',
            'city': 'Damascus',
            'phone': '+96393123456',
          },
        };

        when(() => mockDio.post(any(), data: any(named: 'data'))).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final result = await authRepository.register(
          name: 'John Doe',
          pharmacyName: 'My Pharmacy',
          phone: '+96393123456',
          address: 'Main St',
          password: 'Password123',
        );

        expect(result.token, equals('auth_token'));
        expect(result.user.id, equals('user1'));
        expect(result.pharmacy?.id, equals('pharm1'));
      });

      test('includes coordinates in request when provided', () async {
        final responseData = {
          'token': 'token',
          'user': {
            'id': 'user1',
            'name': 'Test',
            'phone': '+96393123456',
            'role': 'pharmacy',
            'status': 'active',
            'lang': 'ar',
          },
        };

        when(() => mockDio.post(any(), data: any(named: 'data'))).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        await authRepository.register(
          name: 'Test',
          pharmacyName: 'Test Pharmacy',
          phone: '+96393123456',
          address: 'Address',
          password: 'Pass123',
          latitude: 33.5138,
          longitude: 36.2765,
        );

        verify(
          () => mockDio.post(Endpoints.register, data: any(named: 'data')),
        ).called(1);
      });

      test('throws ServerFailure on registration failure', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.badResponse,
          response: Response(
            statusCode: 400,
            data: {'message': 'Invalid data'},
            requestOptions: RequestOptions(path: ''),
          ),
        );

        when(
          () => mockDio.post(any(), data: any(named: 'data')),
        ).thenThrow(dioError);

        expect(
          () => authRepository.register(
            name: 'Test',
            pharmacyName: 'Pharmacy',
            phone: '+96393123456',
            address: 'Address',
            password: 'Pass123',
          ),
          throwsA(isA<ServerFailure>()),
        );
      });
    });

    group('loginWithPassword', () {
      test('returns AuthResponse on successful login', () async {
        final responseData = {
          'token': 'login_token',
          'user': {
            'id': 'user1',
            'name': 'John',
            'phone': '+96393123456',
            'role': 'pharmacy',
            'status': 'active',
            'lang': 'ar',
          },
        };

        when(() => mockDio.post(any(), data: any(named: 'data'))).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final result = await authRepository.loginWithPassword(
          phone: '+96393123456',
          password: 'Password123',
        );

        expect(result.token, equals('login_token'));
        expect(result.user.phone, equals('+96393123456'));
      });

      test('sends correct data in login request', () async {
        when(() => mockDio.post(any(), data: any(named: 'data'))).thenAnswer(
          (_) async => Response(
            data: {
              'token': 'token',
              'user': {
                'id': 'user1',
                'name': 'Test',
                'phone': '+96393123456',
                'role': 'pharmacy',
                'status': 'active',
                'lang': 'ar',
              },
            },
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        await authRepository.loginWithPassword(
          phone: '+96393123456',
          password: 'Pass123',
        );

        verify(
          () => mockDio.post(
            Endpoints.loginPassword,
            data: {'phone': '+96393123456', 'password': 'Pass123'},
          ),
        ).called(1);
      });

      test('throws ServerFailure on login error', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.badResponse,
          response: Response(
            statusCode: 401,
            data: {'message': 'Invalid credentials'},
            requestOptions: RequestOptions(path: ''),
          ),
        );

        when(
          () => mockDio.post(any(), data: any(named: 'data')),
        ).thenThrow(dioError);

        expect(
          () => authRepository.loginWithPassword(
            phone: '+96393123456',
            password: 'WrongPassword',
          ),
          throwsA(isA<ServerFailure>()),
        );
      });
    });

    group('getMe', () {
      test('returns MeResponse on successful call', () async {
        final responseData = {
          'user': {
            'id': 'user1',
            'name': 'John Doe',
            'phone': '+96393123456',
            'role': 'pharmacy',
            'status': 'active',
            'lang': 'ar',
          },
          'pharmacy': {
            'id': 'pharm1',
            'nameAr': 'صيدليتي',
            'nameEn': 'My Pharmacy',
            'ownerName': 'John Doe',
            'address': 'Main St',
            'city': 'Damascus',
            'phone': '+96393123456',
          },
        };

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final result = await authRepository.getMe();

        expect(result.user.id, equals('user1'));
        expect(result.pharmacy?.id, equals('pharm1'));
        verify(() => mockDio.get(Endpoints.me)).called(1);
      });

      test('throws ServerFailure when not authenticated', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.badResponse,
          response: Response(
            statusCode: 401,
            data: {'message': 'Unauthorized'},
            requestOptions: RequestOptions(path: ''),
          ),
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(() => authRepository.getMe(), throwsA(isA<ServerFailure>()));
      });
    });
  });
}
