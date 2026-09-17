import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:feniq/core/error/error_translator.dart';
import 'package:feniq/core/error/failure.dart';
import 'package:feniq/generated/app_localizations.dart';

void main() {
  late AppLocalizations en;
  late AppLocalizations ar;

  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
    ar = await AppLocalizations.delegate.load(const Locale('ar'));
  });

  group('translateErrorCode - technical errors become friendly sentences', () {
    test('network error', () {
      expect(translateErrorCode(en, FailureCode.network, 'No Internet Connection'), en.errorNetwork);
      expect(translateErrorCode(ar, FailureCode.network, 'No Internet Connection'), ar.errorNetwork);
      // The raw technical string is never what the user sees.
      expect(translateErrorCode(en, FailureCode.network, 'SocketException'),
          isNot(contains('SocketException')));
    });

    test('timeout', () {
      expect(translateErrorCode(en, FailureCode.timeout, 'Receive timeout with ApiServer'), en.errorTimeout);
      expect(translateErrorCode(ar, FailureCode.timeout, 'x'), ar.errorTimeout);
    });

    test('HTTP 401 / 403 / 404', () {
      expect(translateErrorCode(en, 'HTTP_401', 'x'), en.errorSessionExpired);
      expect(translateErrorCode(en, 'HTTP_403', 'x'), en.errorNoPermission);
      expect(translateErrorCode(en, 'HTTP_404', 'x'), en.errorNotFound);
      expect(translateErrorCode(ar, 'HTTP_404', 'x'), ar.errorNotFound);
    });

    // Auth codes (F-01/F-02). The backend used to send no `code` at all on
    // these, so they fell through to the raw English `fallbackMessage` even
    // in Arabic - the assertions below are what stops that regressing.
    test('auth failures are localized, not passed through in English', () {
      const rawEnglish = 'Incorrect phone number or password.';

      expect(translateErrorCode(en, 'INVALID_CREDENTIALS', rawEnglish),
          en.errorInvalidCredentials);
      expect(translateErrorCode(ar, 'INVALID_CREDENTIALS', rawEnglish),
          ar.errorInvalidCredentials);
      expect(translateErrorCode(ar, 'INVALID_CREDENTIALS', rawEnglish),
          isNot(rawEnglish));

      expect(translateErrorCode(ar, 'ACCOUNT_BLOCKED', 'x'), ar.errorAccountBlocked);
      expect(translateErrorCode(ar, 'ACCOUNT_NOT_FOUND', 'x'), ar.errorAccountNotFound);
      expect(translateErrorCode(ar, 'PHONE_ALREADY_REGISTERED', 'x'),
          ar.errorPhoneAlreadyRegistered);
    });

    // The 409 from /auth/register (F-01) carries its code in the body rather
    // than relying on a status fallback - _httpFallbackCode has no 409 case,
    // so without the code this would render as raw English.
    test('a 409 conflict body still resolves to localized copy', () {
      final failure = ServerFailure.fromResponse(409, {
        'message': 'This phone number is already registered. Please log in instead.',
        'code': 'PHONE_ALREADY_REGISTERED',
      });

      expect(failure.statusCode, 409);
      expect(failure.code, 'PHONE_ALREADY_REGISTERED');
      expect(translateErrorCode(ar, failure.code, failure.errMessage),
          ar.errorPhoneAlreadyRegistered);
    });

    // POST /orders refusing a key that already placed an order from a
    // different cart. The body's English message must not reach an Arabic
    // pharmacist.
    test('the 409 IDEMPOTENCY_KEY_REUSED body resolves to localized copy', () {
      final failure = ServerFailure.fromResponse(409, {
        'success': false,
        'message': 'This order request was already submitted with different contents.',
        'code': 'IDEMPOTENCY_KEY_REUSED',
        'details': {'orderId': 'o1', 'orderNumber': 1042},
      });

      expect(failure.code, 'IDEMPOTENCY_KEY_REUSED');
      expect(failure.details?['orderNumber'], 1042);
      expect(translateErrorCode(en, failure.code, failure.errMessage),
          en.errorIdempotencyKeyReused);
      expect(translateErrorCode(ar, failure.code, failure.errMessage),
          ar.errorIdempotencyKeyReused);
    });

    test('HTTP 500 / 502 / 503 all map to the same server-error copy', () {
      expect(translateErrorCode(en, 'HTTP_500', 'x'), en.errorServer);
      expect(translateErrorCode(en, 'HTTP_502', 'x'), en.errorServer);
      expect(translateErrorCode(en, 'HTTP_503', 'x'), en.errorServer);
    });

    test('an unknown code falls back to the provided message', () {
      expect(translateErrorCode(en, null, 'A specific server message'), 'A specific server message');
      expect(translateErrorCode(en, 'SOME_NEW_BACKEND_CODE', 'fallback text'), 'fallback text');
    });

    test('a known backend domain code is still localized', () {
      expect(translateErrorCode(en, 'CART_EMPTY', 'raw'), en.cartEmptyMessage);
    });

    test('delivery seal photo codes are localized in both languages', () {
      expect(
        translateErrorCode(en, 'DELIVERY_SEAL_PHOTO_REQUIRED', 'raw'),
        en.errorDeliverySealPhotoRequired,
      );
      expect(
        translateErrorCode(ar, 'DELIVERY_SEAL_PHOTO_REQUIRED', 'raw'),
        ar.errorDeliverySealPhotoRequired,
      );
      expect(
        translateErrorCode(en, 'INVALID_DELIVERY_SEAL_PHOTO', 'raw'),
        en.errorInvalidDeliverySealPhoto,
      );
      expect(
        translateErrorCode(en, 'ORDER_NOT_AWAITING_DELIVERY', 'raw'),
        en.errorOrderNotAwaitingDelivery,
      );
      // The raw code is never what the user sees.
      expect(
        translateErrorCode(en, 'DELIVERY_SEAL_PHOTO_REQUIRED', 'raw'),
        isNot(contains('DELIVERY_SEAL')),
      );
    });
  });
}
