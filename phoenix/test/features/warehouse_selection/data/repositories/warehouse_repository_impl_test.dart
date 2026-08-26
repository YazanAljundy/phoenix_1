import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_model.dart';
import 'package:phoenix/features/warehouse_selection/data/repositories/warehouse_repository_impl.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockDio extends Mock implements Dio {}

void main() {
  late MockApiClient mockApiClient;
  late MockDio mockDio;
  late WarehouseRepositoryImpl warehouseRepository;

  setUp(() {
    mockApiClient = MockApiClient();
    mockDio = MockDio();
    when(() => mockApiClient.dio).thenReturn(mockDio);
    warehouseRepository = WarehouseRepositoryImpl(apiClient: mockApiClient);
  });

  group('WarehouseRepositoryImpl', () {
    group('getWarehouses', () {
      test('returns list of warehouses on success', () async {
        final responseData = {
          'warehouses': [
            {
              'id': 'wh1',
              'nameAr': 'مستودع دمشق',
              'nameEn': 'Damascus Warehouse',
              'city': 'Damascus',
              'phone': '+96311234567',
              'logo': 'https://example.com/logo1.png',
            },
            {
              'id': 'wh2',
              'nameAr': 'مستودع حلب',
              'nameEn': 'Aleppo Warehouse',
              'city': 'Aleppo',
              'phone': '+96321234567',
            },
          ],
        };

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final warehouses = await warehouseRepository.getWarehouses();

        expect(warehouses, isA<List<WarehouseModel>>());
        expect(warehouses.length, equals(2));
        expect(warehouses[0].id, equals('wh1'));
        expect(warehouses[0].nameAr, equals('مستودع دمشق'));
        expect(warehouses[1].id, equals('wh2'));
        verify(() => mockDio.get(Endpoints.warehouses)).called(1);
      });

      test('returns empty list when no warehouses', () async {
        final responseData = {'warehouses': []};

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final warehouses = await warehouseRepository.getWarehouses();

        expect(warehouses, isEmpty);
      });

      test('throws ServerFailure on API error', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.connectionTimeout,
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(
          () => warehouseRepository.getWarehouses(),
          throwsA(isA<ServerFailure>()),
        );
      });

      test('throws ServerFailure on bad response', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.badResponse,
          response: Response(
            statusCode: 500,
            data: {'message': 'Server error'},
            requestOptions: RequestOptions(path: ''),
          ),
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(
          () => warehouseRepository.getWarehouses(),
          throwsA(isA<ServerFailure>()),
        );
      });

      test('parses warehouses with all optional fields', () async {
        final responseData = {
          'warehouses': [
            {
              'id': 'wh1',
              'nameAr': 'مستودع',
              'nameEn': 'Warehouse',
              'city': 'City',
              'phone': '0991234567',
              'logo': 'https://example.com/logo.png',
            },
          ],
        };

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final warehouses = await warehouseRepository.getWarehouses();

        expect(warehouses[0].logo, equals('https://example.com/logo.png'));
      });
    });

    group('getWarehouseProfile', () {
      test('returns warehouse profile on success', () async {
        const warehouseId = 'wh1';
        final responseData = {
          'id': 'wh1',
          'nameAr': 'مستودع دمشق',
          'nameEn': 'Damascus Warehouse',
          'address': 'Main Street 123',
          'city': 'Damascus',
          'phone': '+96311234567',
          'deliveryType': 'home',
          'averageRating': 4.5,
          'reviewsCount': 100,
          'recentReviews': [],
        };

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final profile = await warehouseRepository.getWarehouseProfile(
          warehouseId,
        );

        expect(profile.id, equals('wh1'));
        expect(profile.nameAr, equals('مستودع دمشق'));
        verify(
          () => mockDio.get(Endpoints.warehouseProfile(warehouseId)),
        ).called(1);
      });

      test('throws ServerFailure on API error', () async {
        const warehouseId = 'wh1';
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.receiveTimeout,
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(
          () => warehouseRepository.getWarehouseProfile(warehouseId),
          throwsA(isA<ServerFailure>()),
        );
      });

      test('throws ServerFailure on bad response', () async {
        const warehouseId = 'wh999';
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.badResponse,
          response: Response(
            statusCode: 404,
            data: {'message': 'Warehouse not found'},
            requestOptions: RequestOptions(path: ''),
          ),
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(
          () => warehouseRepository.getWarehouseProfile(warehouseId),
          throwsA(isA<ServerFailure>()),
        );
      });

      test('calls correct endpoint with warehouse ID', () async {
        const warehouseId = 'wh123';
        final responseData = {
          'id': 'wh123',
          'nameAr': 'مستودع',
          'nameEn': 'Warehouse',
          'address': 'Address',
          'city': 'City',
          'phone': '0991234567',
          'deliveryType': 'home',
          'averageRating': 4.0,
          'reviewsCount': 50,
          'recentReviews': [],
        };

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        await warehouseRepository.getWarehouseProfile(warehouseId);

        verify(
          () => mockDio.get(Endpoints.warehouseProfile(warehouseId)),
        ).called(1);
      });
    });
  });
}
