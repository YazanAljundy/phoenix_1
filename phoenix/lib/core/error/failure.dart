import 'dart:developer';

import 'package:dio/dio.dart';

/// Stable, machine-readable identifiers for the transport-level failures the
/// client produces itself (the backend supplies its own domain codes - see
/// backend/src/utils/ApiError.js). Views never show these directly: they go
/// through [translateErrorCode] (core/error/error_translator.dart) which
/// turns them into a localized, user-facing sentence.
class FailureCode {
  const FailureCode._();

  static const String network = 'NETWORK_ERROR';
  static const String timeout = 'TIMEOUT';
  static const String unexpected = 'UNEXPECTED_ERROR';

  /// Synthesised for a bad HTTP response the backend did not tag with a
  /// `code` of its own - e.g. 'HTTP_404'. Only produced for statuses the
  /// translator has canonical localized copy for (401/403/404/5xx).
  static String http(int statusCode) => 'HTTP_$statusCode';
}

abstract class Failure {
  const Failure(this.errMessage, {this.code, this.details});

  // English, for developer logs and as the last-resort fallback for any
  // `code` the translator has not been taught yet. Not meant to be shown to
  // the user as-is - see translateErrorCode.
  final String errMessage;

  // `code` is the backend's stable machine-readable error identifier (e.g.
  // 'INSUFFICIENT_STOCK'), or one of [FailureCode] for a transport error -
  // null only for legacy endpoints that send neither. See
  // core/error/error_translator.dart for turning a code into a localized
  // string.
  final String? code;
  final Map<String, dynamic>? details;
}

class ServerFailure extends Failure {
  ServerFailure(super.errMessage, {super.code, super.details, this.statusCode});

  /// The HTTP status code, when this failure came from an actual HTTP
  /// response (`fromResponse`). Null for transport-level errors that never
  /// reached a response - timeout, no connection, cancel.
  ///
  /// Lets the session layer tell a real 401/403 token rejection apart from
  /// "couldn't reach the server", so a network blip never deletes a valid
  /// token. See AuthCubit.checkSession.
  final int? statusCode;

  factory ServerFailure.fromDioError(DioException dioError) {
    switch (dioError.type) {
      case DioExceptionType.connectionTimeout:
        _logTechnical(dioError);
        return ServerFailure('Connection timeout with ApiServer', code: FailureCode.timeout);

      case DioExceptionType.sendTimeout:
        _logTechnical(dioError);
        return ServerFailure('Send timeout with ApiServer', code: FailureCode.timeout);

      case DioExceptionType.receiveTimeout:
        _logTechnical(dioError);
        return ServerFailure('Receive timeout with ApiServer', code: FailureCode.timeout);

      case DioExceptionType.badResponse:
        return ServerFailure.fromResponse(
          dioError.response?.statusCode,
          dioError.response?.data,
        );

      case DioExceptionType.cancel:
        return ServerFailure('Request to ApiServer was canceled');

      case DioExceptionType.connectionError:
        _logTechnical(dioError);
        return ServerFailure('No Internet Connection', code: FailureCode.network);

      case DioExceptionType.unknown:
        if ((dioError.message ?? '').contains('SocketException')) {
          _logTechnical(dioError);
          return ServerFailure('No Internet Connection', code: FailureCode.network);
        }
        _logTechnical(dioError);
        return ServerFailure('Unexpected Error, Please try again!', code: FailureCode.unexpected);

      default:
        // Was concatenating dioError.toString() straight into the message -
        // that leaked "DioException [..]: ..." to the user. Now logged for
        // the developer, generic + coded for the UI.
        _logTechnical(dioError);
        return ServerFailure('Unexpected Error, Please try again!', code: FailureCode.unexpected);
    }
  }

  factory ServerFailure.fromResponse(int? statusCode, dynamic response) {
    log('API error ${statusCode ?? '?'}: ${response.toString()}');
    final serverMessage = response is Map
        ? (response['message'] ?? response['error'])
        : null;
    final code = response is Map ? response['code'] as String? : null;
    final details = response is Map ? response['details'] as Map<String, dynamic>? : null;

    // A human message from the backend wins - it's the specific, actionable
    // one (e.g. "Incorrect phone number or password."). Its own `code`, if
    // any, still lets the translator localize it.
    if (serverMessage is String && serverMessage.isNotEmpty) {
      return ServerFailure(serverMessage, code: code, details: details, statusCode: statusCode);
    }

    // No usable message: fall back to a status-derived code so the UI can
    // still say something friendly and localized for the common statuses.
    final fallbackCode = code ?? _httpFallbackCode(statusCode);
    if (statusCode == 500) {
      return ServerFailure(
        'Internal Server error, Please try later',
        code: fallbackCode,
        statusCode: statusCode,
      );
    }
    return ServerFailure(
      'Oops! There was an Error, Please try again',
      code: fallbackCode,
      statusCode: statusCode,
    );
  }

  // Only the statuses translateErrorCode has canonical localized copy for -
  // anything else stays null and the generic fallback message is used.
  static String? _httpFallbackCode(int? statusCode) {
    switch (statusCode) {
      case 401:
      case 403:
      case 404:
      case 500:
      case 502:
      case 503:
        return FailureCode.http(statusCode!);
      default:
        return null;
    }
  }

  // Developer-only. Deliberately logs just the type/status/path - never
  // headers or body, which can carry tokens or credentials.
  static void _logTechnical(DioException e) {
    log(
      'API ERROR\n'
      '  type: ${e.type}\n'
      '  status: ${e.response?.statusCode ?? '-'}\n'
      '  endpoint: ${e.requestOptions.method} ${e.requestOptions.path}\n'
      '  detail: ${e.message ?? e.error ?? '-'}',
      name: 'ApiClient',
    );
  }
}
