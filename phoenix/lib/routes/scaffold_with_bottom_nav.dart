import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';

// Section 6: the four top-level tabs (warehouses/my orders/returns/profile) -
// everything else (catalog, cart, order tracking) pushes on top of this
// shell as a full-screen route instead of being a tab, since those are
// detail flows entered FROM a tab, not destinations of their own.
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
          destinations: [
            NavigationDestination(
              icon: const Icon(Icons.storefront_outlined),
              selectedIcon: Icon(Icons.storefront, color: AppColors.primaryOf(context)),
              label: l10n.navWarehouses,
            ),
            NavigationDestination(
              icon: const Icon(Icons.receipt_long_outlined),
              selectedIcon: Icon(Icons.receipt_long, color: AppColors.primaryOf(context)),
              label: l10n.myOrdersTitle,
            ),
            NavigationDestination(
              icon: const Icon(Icons.assignment_return_outlined),
              selectedIcon: Icon(Icons.assignment_return, color: AppColors.primaryOf(context)),
              label: l10n.returnsTitle,
            ),
            NavigationDestination(
              icon: const Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person, color: AppColors.primaryOf(context)),
              label: l10n.profileTitle,
            ),
          ],
        ),
      ),
    );
  }
}
