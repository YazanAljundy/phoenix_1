import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/models/paginated_result.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/catalog/data/models/category_model.dart';
import 'package:phoenix/features/catalog/data/models/product_model.dart';
import 'package:phoenix/features/catalog/data/repositories/catalog_repository_impl.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockDio extends Mock implements Dio {}

void main() {
  late MockApiClient mockApiClient;
  late MockDio mockDio;
  late CatalogRepositoryImpl catalogRepository;

  setUp(() {
    mockApiClient = MockApiClient();
    mockDio = MockDio();
    when(() => mockApiClient.dio).thenReturn(mockDio);
    catalogRepository = CatalogRepositoryImpl(apiClient: mockApiClient);
  });

  group('CatalogRepositoryImpl', () {
    group('getCategories', () {
      test('returns list of categories on success', () async {
        final responseData = {
          'categories': [
            {
              'id': 'cat1',
              'nameAr': 'أدوية',
              'nameEn': 'Medicines',
              'sortOrder': 1,
            },
            {
              'id': 'cat2',
              'nameAr': 'مكملات',
              'nameEn': 'Supplements',
              'sortOrder': 2,
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

        final categories = await catalogRepository.getCategories();

        expect(categories, isA<List<CategoryModel>>());
        expect(categories.length, equals(2));
        expect(categories[0].id, equals('cat1'));
        expect(categories[0].nameAr, equals('أدوية'));
        expect(categories[1].id, equals('cat2'));
        verify(() => mockDio.get(Endpoints.categories)).called(1);
      });

      test('returns empty list when no categories', () async {
        final responseData = {'categories': []};

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final categories = await catalogRepository.getCategories();

        expect(categories, isEmpty);
      });

      test('throws ServerFailure on API error', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.connectionTimeout,
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(
          () => catalogRepository.getCategories(),
          throwsA(isA<ServerFailure>()),
        );
      });

      test('throws ServerFailure on bad response', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.badResponse,
          response: Response(
            statusCode: 404,
            data: {'message': 'Not found'},
            requestOptions: RequestOptions(path: ''),
          ),
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(
          () => catalogRepository.getCategories(),
          throwsA(isA<ServerFailure>()),
        );
      });
    });

    group('getProducts', () {
      test('returns paginated products with all filters', () async {
        final responseData = {
          'products': [
            {
              'id': 'prod1',
              'nameAr': 'أسبرين',
              'manufacturerAr': 'بايير',
              'priceUsd': 5.0,
              'discountPriceUsd': 4.0,
              'isAvailable': true,
            },
          ],
          'pagination': {'hasMore': true, 'nextCursor': 'cursor123'},
        };

        when(
          () => mockDio.get(
            any(),
            queryParameters: any(named: 'queryParameters'),
          ),
        ).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final result = await catalogRepository.getProducts(
          warehouseId: 'warehouse1',
          search: 'aspirin',
          categoryId: 'cat1',
          manufacturer: 'Bayer',
          limit: 20,
          after: 'prev_cursor',
        );

        expect(result, isA<PaginatedResult<ProductModel>>());
        expect(result.items.length, equals(1));
        expect(result.items[0].id, equals('prod1'));
        expect(result.hasMore, isTrue);
        expect(result.nextCursor, equals('cursor123'));

        verify(
          () => mockDio.get(
            Endpoints.warehouseProducts('warehouse1'),
            queryParameters: {
              'search': 'aspirin',
              'categoryId': 'cat1',
              'manufacturer': 'Bayer',
              'limit': 20,
              'after': 'prev_cursor',
            },
          ),
        ).called(1);
      });

      test('includes only non-null query parameters', () async {
        final responseData = {
          'products': [],
          'pagination': {'hasMore': false},
        };

        when(
          () => mockDio.get(
            any(),
            queryParameters: any(named: 'queryParameters'),
          ),
        ).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        await catalogRepository.getProducts(warehouseId: 'warehouse1');

        verify(
          () => mockDio.get(
            Endpoints.warehouseProducts('warehouse1'),
            queryParameters: {},
          ),
        ).called(1);
      });

      test('ignores empty search parameter', () async {
        final responseData = {
          'products': [],
          'pagination': {'hasMore': false},
        };

        when(
          () => mockDio.get(
            any(),
            queryParameters: any(named: 'queryParameters'),
          ),
        ).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        await catalogRepository.getProducts(
          warehouseId: 'warehouse1',
          search: '',
        );

        verify(
          () => mockDio.get(
            any(),
            queryParameters: any(named: 'queryParameters'),
          ),
        ).called(1);
      });

      test('returns empty products list', () async {
        final responseData = {
          'products': [],
          'pagination': {'hasMore': false},
        };

        when(
          () => mockDio.get(
            any(),
            queryParameters: any(named: 'queryParameters'),
          ),
        ).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final result = await catalogRepository.getProducts(
          warehouseId: 'warehouse1',
        );

        expect(result.items, isEmpty);
        expect(result.hasMore, isFalse);
      });

      test('throws ServerFailure on API error', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.receiveTimeout,
        );

        when(
          () => mockDio.get(
            any(),
            queryParameters: any(named: 'queryParameters'),
          ),
        ).thenThrow(dioError);

        expect(
          () => catalogRepository.getProducts(warehouseId: 'warehouse1'),
          throwsA(isA<ServerFailure>()),
        );
      });
    });

    group('getManufacturers', () {
      test('returns list of manufacturers', () async {
        final responseData = {
          'manufacturers': ['Bayer', 'Novartis', 'Pfizer'],
        };

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final manufacturers = await catalogRepository.getManufacturers(
          warehouseId: 'warehouse1',
        );

        expect(manufacturers, equals(['Bayer', 'Novartis', 'Pfizer']));
        verify(
          () => mockDio.get(Endpoints.warehouseManufacturers('warehouse1')),
        ).called(1);
      });

      test('returns empty list when no manufacturers', () async {
        final responseData = {'manufacturers': []};

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final manufacturers = await catalogRepository.getManufacturers(
          warehouseId: 'warehouse1',
        );

        expect(manufacturers, isEmpty);
      });

      test('throws ServerFailure on API error', () async {
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
          () => catalogRepository.getManufacturers(warehouseId: 'warehouse1'),
          throwsA(isA<ServerFailure>()),
        );
      });
    });
  });
}
