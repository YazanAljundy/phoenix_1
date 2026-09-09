import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/generated/app_localizations.dart';

// Section 6: the five top-level tabs (warehouses / offers & ads / my orders /
// account history / profile) - everything else (catalog, cart, order tracking,
// and the returns and debts pages) pushes on top of this shell as a
// full-screen route instead of being a tab, since those are detail flows
// entered FROM a tab, not destinations of their own.
//
// The Offers & Ads tab sits second, next to the warehouse list: both are
// browsing destinations, and a promotion leads straight back into that same
// catalog flow. Its label is the short `navOffers` rather than the screen's own
// "Offers & Ads" title - five labels have to fit one bar in both languages, and
// every other tab here is one word too.
//
// `accountHistoryTitle` is the exception: it is a two-word screen title reused
// as a tab label, and at the theme's old 11px it measured ~78pt against the
// ~72pt a fifth of a 360dp phone gives it. NavigationBar builds its label as a
// bare `Text` with no maxLines, so it wrapped to two or three lines - and the
// layout delegate offsets each destination's icon by half its own label
// height, so a taller label dragged that one tab's icon *up* out of line with
// its neighbours. That is the "سجل الحسابات" misalignment: the fix is to keep
// every label on one line so every icon resolves to the same offset.
class ScaffoldWithBottomNav extends StatelessWidget {
  const ScaffoldWithBottomNav({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      body: navigationShell,
      // A soft shadow cast upward onto the body content above the bar
      // (Section 1 of the visual-polish pass) - NavigationBar itself has no
      // "shadow above" concept, so this wraps it in a plain decorated box.
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.1),
              blurRadius: 8,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          onDestinationSelected: (index) {
            navigationShell.goBranch(
              index,
              initialLocation: index == navigationShell.currentIndex,
            );
          },
          // Each destination is wrapped so its label can never wrap to a
          // second line: NavigationBar's own Material resets DefaultTextStyle,
          // so this has to sit *inside* the bar, around each destination,
          // rather than around the bar itself. With every label a uniform one
          // line tall, all five icons resolve to the same offset. The ellipsis
          // is only a floor for very narrow screens or a large system text
          // scale - at the theme's label size the longest label fits whole.
          destinations: [
            for (final destination in _destinations(context, l10n))
              DefaultTextStyle.merge(
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                child: destination,
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _destinations(BuildContext context, AppLocalizations l10n) => [
    NavigationDestination(
      icon: const Icon(Icons.storefront_outlined),
      selectedIcon: Icon(Icons.storefront, color: AppColors.primaryOf(context)),
      label: l10n.navWarehouses,
    ),
    NavigationDestination(
      icon: const Icon(Icons.local_offer_outlined),
      selectedIcon: Icon(Icons.local_offer, color: AppColors.primaryOf(context)),
      label: l10n.navOffers,
    ),
    NavigationDestination(
      icon: const Icon(Icons.receipt_long_outlined),
      selectedIcon: Icon(Icons.receipt_long, color: AppColors.primaryOf(context)),
      label: l10n.myOrdersTitle,
    ),
    NavigationDestination(
      icon: const Icon(Icons.account_balance_wallet_outlined),
      selectedIcon: Icon(Icons.account_balance_wallet, color: AppColors.primaryOf(context)),
      label: l10n.accountHistoryTitle,
    ),
    NavigationDestination(
      icon: const Icon(Icons.person_outline),
      selectedIcon: Icon(Icons.person, color: AppColors.primaryOf(context)),
      label: l10n.profileTitle,
    ),
  ];

}
