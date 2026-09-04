import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix/generated/app_localizations.dart';

// Every user-facing string the advertisement feature adds must exist in BOTH
// English and Arabic - nothing hardcoded in a widget.
void main() {
  late AppLocalizations en;
  late AppLocalizations ar;

  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
    ar = await AppLocalizations.delegate.load(const Locale('ar'));
  });

  test('every advertisement label is present in EN and AR', () {
    for (final l10n in [en, ar]) {
      expect(l10n.advertisementsSectionTitle.trim(), isNotEmpty);
      expect(l10n.advertisementPackageTotal.trim(), isNotEmpty);
      expect(l10n.advertisementDiscountLabel.trim(), isNotEmpty);
      expect(l10n.advertisementTotalToPay.trim(), isNotEmpty);
      expect(l10n.advertisementAddToCartButton.trim(), isNotEmpty);
      expect(l10n.advertisementReplaceCartTitle.trim(), isNotEmpty);
      expect(l10n.advertisementReplaceCartMessage.trim(), isNotEmpty);
      expect(l10n.advertisementReplaceCartConfirm.trim(), isNotEmpty);
      expect(l10n.advertisementUnavailableTitle.trim(), isNotEmpty);
      expect(l10n.advertisementUnavailableMessage.trim(), isNotEmpty);
      expect(l10n.advertisementPackageBrokenMessage.trim(), isNotEmpty);
      expect(l10n.advertisementsLoading.trim(), isNotEmpty);
      expect(l10n.advertisementsEmpty.trim(), isNotEmpty);
      expect(l10n.advertisementsError.trim(), isNotEmpty);
    }
  });

  test('placeholders survive translation in both languages', () {
    for (final l10n in [en, ar]) {
      expect(l10n.advertisementSavingPercent(15).contains('15'), isTrue);
      expect(l10n.advertisementIncompleteMessage('Panadol').contains('Panadol'), isTrue);
      expect(l10n.advertisementProductCount(3).contains('3'), isTrue);
      expect(l10n.advertisementItemQuantity(5).contains('5'), isTrue);
    }
  });

  test('the Arabic strings are actually Arabic, not an English fallback', () {
    expect(ar.advertisementsSectionTitle, isNot(en.advertisementsSectionTitle));
    expect(ar.advertisementPackageTotal, isNot(en.advertisementPackageTotal));
    expect(ar.advertisementDiscountLabel, isNot(en.advertisementDiscountLabel));
    expect(ar.advertisementTotalToPay, isNot(en.advertisementTotalToPay));
    expect(ar.advertisementAddToCartButton, isNot(en.advertisementAddToCartButton));
  });

  // The cart's discount row and "total to pay" row must read as different
  // things.
  test('the cart pricing rows are labelled distinctly', () {
    for (final l10n in [en, ar]) {
      expect(l10n.advertisementDiscountLabel, isNot(l10n.advertisementTotalToPay));
      expect(l10n.advertisementPackageTotal, isNot(l10n.advertisementTotalToPay));
    }
  });
}
