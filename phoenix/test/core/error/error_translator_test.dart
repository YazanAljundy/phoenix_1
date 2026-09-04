import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/generated/app_localizations.dart';

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
