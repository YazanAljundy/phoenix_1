import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/error/failure.dart';

void main() {
  group('Failure', () {
    group('constructor', () {
      test('creates ServerFailure with message', () {
        final failure = ServerFailure('Test error message');

        expect(failure.errMessage, equals('Test error message'));
        expect(failure.code, isNull);
        expect(failure.details, isNull);
      });

      test('creates ServerFailure with code', () {
        final failure = ServerFailure('Invalid input', code: 'INVALID_INPUT');

        expect(failure.errMessage, equals('Invalid input'));
        expect(failure.code, equals('INVALID_INPUT'));
      });

      test('creates ServerFailure with details', () {
        const details = {'field': 'email', 'reason': 'invalid format'};
        final failure = ServerFailure(
          'Validation error',
          code: 'VALIDATION_ERROR',
          details: details,
        );

        expect(failure.details, equals(details));
      });
    });
  });

  group('ServerFailure', () {
    group('fromDioError', () {
      test('handles connection timeout', () {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.connectionTimeout,
        );

        final failure = ServerFailure.fromDioError(dioError);

        expect(failure.errMessage, equals('Connection timeout with ApiServer'));
      });

      test('handles send timeout', () {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.sendTimeout,
        );

        final failure = ServerFailure.fromDioError(dioError);

        expect(failure.errMessage, equals('Send timeout with ApiServer'));
      });

      test('handles receive timeout', () {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.receiveTimeout,
        );

        final failure = ServerFailure.fromDioError(dioError);

        expect(failure.errMessage, equals('Receive timeout with ApiServer'));
      });

      test('handles request cancelled', () {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.cancel,
        );

        final failure = ServerFailure.fromDioError(dioError);

        expect(failure.errMessage, equals('Request to ApiServer was canceled'));
      });

      test('handles bad response', () {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.badResponse,
          response: Response(
            statusCode: 400,
            data: {'message': 'Bad request'},
            requestOptions: RequestOptions(path: ''),
          ),
        );

        final failure = ServerFailure.fromDioError(dioError);

        expect(failure.errMessage, equals('Bad request'));
      });

      test('handles no internet connection', () {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.unknown,
          message: 'SocketException: Connection refused',
        );

        final failure = ServerFailure.fromDioError(dioError);

        expect(failure.errMessage, equals('No Internet Connection'));
      });

      test('handles unknown error', () {
        final dioError = DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.unknown,
          message: 'Some unknown error',
        );

        final failure = ServerFailure.fromDioError(dioError);

        expect(
          failure.errMessage,
          equals('Unexpected Error, Please try again!'),
        );
      });
    });

    group('fromResponse', () {
      test('extracts message from response', () {
        final response = {
          'message': 'User not found',
          'code': 'USER_NOT_FOUND',
        };

        final failure = ServerFailure.fromResponse(404, response);

        expect(failure.errMessage, equals('User not found'));
        expect(failure.code, equals('USER_NOT_FOUND'));
      });

      test('uses error field when message is missing', () {
        final response = {'error': 'Invalid credentials'};

        final failure = ServerFailure.fromResponse(401, response);

        expect(failure.errMessage, equals('Invalid credentials'));
      });

      test('extracts details from response', () {
        final response = {
          'message': 'Validation failed',
          'code': 'VALIDATION_ERROR',
          'details': {'field': 'email'},
        };

        final failure = ServerFailure.fromResponse(400, response);

        expect(failure.details, equals({'field': 'email'}));
      });

      test('handles 500 status code specially', () {
        final response = {'message': 'Server error'};

        final failure = ServerFailure.fromResponse(500, response);

        expect(failure.errMessage, equals('Server error'));
      });

      test('handles 500 without message', () {
        final response = {};

        final failure = ServerFailure.fromResponse(500, response);

        expect(
          failure.errMessage,
          equals('Internal Server error, Please try later'),
        );
      });

      test('returns default message for non-500 without message', () {
        final response = {};

        final failure = ServerFailure.fromResponse(400, response);

        expect(
          failure.errMessage,
          equals('Oops! There was an Error, Please try again'),
        );
      });

      test('handles string response', () {
        final failure = ServerFailure.fromResponse(500, 'Server error string');

        expect(failure.errMessage, isNotEmpty);
      });

      test('handles empty message string', () {
        final response = {'message': ''};

        final failure = ServerFailure.fromResponse(400, response);

        expect(
          failure.errMessage,
          equals('Oops! There was an Error, Please try again'),
        );
      });

      test('handles response with all fields', () {
        final response = {
          'message': 'Insufficient stock',
          'code': 'INSUFFICIENT_STOCK',
          'details': {'productId': 'prod123', 'available': 5, 'requested': 10},
        };

        final failure = ServerFailure.fromResponse(400, response);

        expect(failure.errMessage, equals('Insufficient stock'));
        expect(failure.code, equals('INSUFFICIENT_STOCK'));
        expect(failure.details?['productId'], equals('prod123'));
      });
    });
  });
}
