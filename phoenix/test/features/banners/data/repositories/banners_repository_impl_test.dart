import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/network/api_client.dart';
import 'package:phoenix/core/network/endpoints.dart';
import 'package:phoenix/features/banners/data/models/banner_model.dart';
import 'package:phoenix/features/banners/data/repositories/banners_repository_impl.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockDio extends Mock implements Dio {}

void main() {
  late MockApiClient mockApiClient;
  late MockDio mockDio;
  late BannersRepositoryImpl bannersRepository;

  setUp(() {
    mockApiClient = MockApiClient();
    mockDio = MockDio();
    when(() => mockApiClient.dio).thenReturn(mockDio);
    bannersRepository = BannersRepositoryImpl(apiClient: mockApiClient);
  });

  group('BannersRepositoryImpl', () {
    group('getActiveBanners', () {
      test('returns list of active banners on success', () async {
        final responseData = {
          'banners': [
            {
              'id': 'banner1',
              'imageUrl': 'https://example.com/banner1.jpg',
              'productId': 'prod1',
              'manufacturerAr': 'الشركة الأولى',
              'warehouseId': 'wh1',
            },
            {
              'id': 'banner2',
              'imageUrl': 'https://example.com/banner2.jpg',
              'productId': 'prod2',
              'manufacturerAr': 'الشركة الثانية',
              'warehouseId': 'wh2',
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

        final banners = await bannersRepository.getActiveBanners();

        expect(banners, isA<List<BannerModel>>());
        expect(banners.length, equals(2));
        expect(banners[0].id, equals('banner1'));
        expect(banners[0].imageUrl, equals('https://example.com/banner1.jpg'));
        expect(banners[1].id, equals('banner2'));
        verify(() => mockDio.get(Endpoints.activeBanners)).called(1);
      });

      test('returns empty list when no active banners', () async {
        final responseData = {'banners': []};

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final banners = await bannersRepository.getActiveBanners();

        expect(banners, isEmpty);
      });

      test('handles banners with all optional fields', () async {
        final responseData = {
          'banners': [
            {
              'id': 'banner1',
              'imageUrl': 'https://example.com/banner.jpg',
              'productId': 'prod1',
              'manufacturerAr': 'Manufacturer',
              'warehouseId': 'wh1',
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

        final banners = await bannersRepository.getActiveBanners();

        expect(banners[0].isTappable, isTrue);
      });

      test('handles banners without optional fields', () async {
        final responseData = {
          'banners': [
            {'id': 'banner1', 'imageUrl': 'https://example.com/banner.jpg'},
          ],
        };

        when(() => mockDio.get(any())).thenAnswer(
          (_) async => Response(
            data: responseData,
            statusCode: 200,
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final banners = await bannersRepository.getActiveBanners();

        expect(banners[0].isTappable, isFalse);
        expect(banners[0].productId, isNull);
      });

      test('throws ServerFailure on connection error', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.connectionTimeout,
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(
          () => bannersRepository.getActiveBanners(),
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
          () => bannersRepository.getActiveBanners(),
          throwsA(isA<ServerFailure>()),
        );
      });

      test('throws ServerFailure on network timeout', () async {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.receiveTimeout,
        );

        when(() => mockDio.get(any())).thenThrow(dioError);

        expect(
          () => bannersRepository.getActiveBanners(),
          throwsA(isA<ServerFailure>()),
        );
      });

      test('parses multiple banners with mixed optional fields', () async {
        final responseData = {
          'banners': [
            {
              'id': 'b1',
              'imageUrl': 'url1',
              'productId': 'p1',
              'manufacturerAr': 'Mfg1',
              'warehouseId': 'w1',
            },
            {'id': 'b2', 'imageUrl': 'url2'},
            {
              'id': 'b3',
              'imageUrl': 'url3',
              'productId': 'p3',
              'manufacturerAr': 'Mfg3',
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

        final banners = await bannersRepository.getActiveBanners();

        expect(banners.length, equals(3));
        expect(banners[0].isTappable, isTrue);
        expect(banners[1].isTappable, isFalse);
        expect(banners[2].isTappable, isFalse);
      });
    });
  });
}
