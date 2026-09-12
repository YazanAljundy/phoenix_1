import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:feniq/generated/app_localizations.dart';

// Every user-facing string the Offers & Ads tab adds must exist in BOTH
// English and Arabic - nothing hardcoded in a widget.
void main() {
  late AppLocalizations en;
  late AppLocalizations ar;

  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
    ar = await AppLocalizations.delegate.load(const Locale('ar'));
  });

  test('every Offers & Ads label is present in EN and AR', () {
    for (final l10n in [en, ar]) {
      expect(l10n.navOffers.trim(), isNotEmpty);
      expect(l10n.offersAndAdsTitle.trim(), isNotEmpty);
      expect(l10n.promotionsAllTitle.trim(), isNotEmpty);
      expect(l10n.promotionsFilterAllTypes.trim(), isNotEmpty);
      expect(l10n.promotionsFilterOffers.trim(), isNotEmpty);
      expect(l10n.promotionsFilterPackages.trim(), isNotEmpty);
      expect(l10n.promotionsAllWarehouses.trim(), isNotEmpty);
      expect(l10n.promotionsWarehouseFilterTitle.trim(), isNotEmpty);
      expect(l10n.promotionsPackageBadge.trim(), isNotEmpty);
      expect(l10n.promotionsEmptyTitle.trim(), isNotEmpty);
      expect(l10n.promotionsEmptyMessage.trim(), isNotEmpty);
      expect(l10n.promotionsNoFilterResults.trim(), isNotEmpty);
      expect(l10n.promotionsClearFilters.trim(), isNotEmpty);
      expect(l10n.promotionsError.trim(), isNotEmpty);
      expect(l10n.offerPermanent.trim(), isNotEmpty);
      expect(l10n.warehouseOffersTitle.trim(), isNotEmpty);
    }
  });

  test('placeholders survive translation in both languages', () {
    for (final l10n in [en, ar]) {
      expect(l10n.offerDiscountPercent(15).contains('15'), isTrue);
      expect(l10n.offerEndsOn('Dec 31, 2026').contains('Dec 31, 2026'), isTrue);
      expect(l10n.promotionsCountSubtitle(4).contains('4'), isTrue);
    }
  });

  test('the Arabic strings are actually Arabic, not an English fallback', () {
    expect(ar.navOffers, isNot(en.navOffers));
    expect(ar.offersAndAdsTitle, isNot(en.offersAndAdsTitle));
    expect(ar.promotionsAllTitle, isNot(en.promotionsAllTitle));
    expect(ar.promotionsEmptyTitle, isNot(en.promotionsEmptyTitle));
    expect(ar.promotionsPackageBadge, isNot(en.promotionsPackageBadge));
    expect(ar.offerPermanent, isNot(en.offerPermanent));
  });

  test('the nav label is short enough for a five-tab bar', () {
    // The other four labels are one word each; a long fifth would push the
    // whole bar into ellipsis. The screen's own title carries the full name.
    for (final l10n in [en, ar]) {
      expect(l10n.navOffers.length, lessThanOrEqualTo(l10n.offersAndAdsTitle.length));
      expect(l10n.navOffers.trim().split(' ').length, 1);
    }
  });

  test('the two promotion kinds are labelled distinctly', () {
    for (final l10n in [en, ar]) {
      expect(l10n.offerBadgeLabel, isNot(l10n.promotionsPackageBadge));
      expect(l10n.promotionsFilterOffers, isNot(l10n.promotionsFilterPackages));
      expect(l10n.promotionsFilterAllTypes, isNot(l10n.promotionsFilterOffers));
    }
  });
}
