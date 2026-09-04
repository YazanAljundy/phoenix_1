import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/generated/app_localizations.dart';

// Every user-facing string the reorder / add-product feature adds must exist
// in both English and Arabic (no hardcoded strings in Dart).
void main() {
  late AppLocalizations en;
  late AppLocalizations ar;

  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
    ar = await AppLocalizations.delegate.load(const Locale('ar'));
  });

  test('reorder / add-product labels are localized in EN and AR', () {
    for (final l10n in [en, ar]) {
      expect(l10n.reorderButton.trim(), isNotEmpty);
      expect(l10n.addProductButton.trim(), isNotEmpty);
      expect(l10n.reorderReplaceCartTitle.trim(), isNotEmpty);
      expect(l10n.reorderReplaceCartMessage.trim(), isNotEmpty);
      expect(l10n.reorderReplaceCartConfirm.trim(), isNotEmpty);
      expect(l10n.reorderUnavailableTitle.trim(), isNotEmpty);
      expect(l10n.reorderNoItemsMessage.trim(), isNotEmpty);
      expect(l10n.reorderSomeItemsUnavailable('X').contains('X'), isTrue);
      expect(l10n.errorOrderNotReorderable.trim(), isNotEmpty);
    }

    expect(en.reorderButton, 'Reorder');
    expect(ar.reorderButton, 'إعادة الطلب');
    expect(en.addProductButton, 'Add product');
    expect(ar.addProductButton, 'إضافة منتج');
  });

  test('ORDER_NOT_REORDERABLE maps to the localized string, not the raw code', () {
    expect(translateErrorCode(en, 'ORDER_NOT_REORDERABLE', 'fallback'), en.errorOrderNotReorderable);
    expect(translateErrorCode(ar, 'ORDER_NOT_REORDERABLE', 'fallback'), ar.errorOrderNotReorderable);
    expect(translateErrorCode(en, 'ORDER_NOT_REORDERABLE', 'fallback'), isNot('fallback'));
  });
}
