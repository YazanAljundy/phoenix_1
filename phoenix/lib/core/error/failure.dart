import 'dart:developer';

import 'package:dio/dio.dart';

abstract class Failure {
  const Failure(this.errMessage, {this.code, this.details});

  final String errMessage;

  // `code` is the backend's stable machine-readable error identifier (e.g.
  // 'INSUFFICIENT_STOCK') - null for endpoints that haven't been migrated to
  // send one yet, in which case callers should just show `errMessage`. See
  // core/error/error_translator.dart for turning a code into a localized
  // string.
  final String? code;
  final Map<String, dynamic>? details;
}

class ServerFailure extends Failure {
  ServerFailure(super.errMessage, {super.code, super.details});

  factory ServerFailure.fromDioError(DioException dioError) {
    switch (dioError.type) {
      case DioExceptionType.connectionTimeout:
        return ServerFailure('Connection timeout with ApiServer');

      case DioExceptionType.sendTimeout:
        return ServerFailure('Send timeout with ApiServer');

      case DioExceptionType.receiveTimeout:
        return ServerFailure('Receive timeout with ApiServer');

      case DioExceptionType.badResponse:
        return ServerFailure.fromResponse(
          dioError.response?.statusCode,
          dioError.response?.data,
        );

      case DioExceptionType.cancel:
        return ServerFailure('Request to ApiServer was canceled');

      case DioExceptionType.unknown:
        if ((dioError.message ?? '').contains('SocketException')) {
          return ServerFailure('No Internet Connection');
        }
        return ServerFailure('Unexpected Error, Please try again!');

      default:
        return ServerFailure(
          'Oops! There was an Error, Please try again+${dioError.toString()}',
        );
    }
  }

  factory ServerFailure.fromResponse(int? statusCode, dynamic response) {
    log(response.toString());
    final serverMessage = response is Map
        ? (response['message'] ?? response['error'])
        : null;
    final code = response is Map ? response['code'] as String? : null;
    final details = response is Map ? response['details'] as Map<String, dynamic>? : null;

    if (serverMessage is String && serverMessage.isNotEmpty) {
      return ServerFailure(serverMessage, code: code, details: details);
    }
    if (statusCode == 500) {
      return ServerFailure('Internal Server error, Please try later');
    }
    return ServerFailure('Oops! There was an Error, Please try again');
  }
}
