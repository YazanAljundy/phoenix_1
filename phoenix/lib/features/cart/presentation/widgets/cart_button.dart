import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_state.dart';
import 'package:phoenix/routes/route_names.dart';

/// The cart icon + live item-count badge for the AppBar of every screen in
/// the shopping flow (warehouse selection, warehouse profile, manufacturers,
/// catalog). One shared widget so the affordance looks and behaves the same
/// everywhere - originally only CatalogView had this, inline.
///
/// Reads the single app-wide [CartCubit] provided at the top of the tree in
/// main.dart via the ambient BlocProvider - it never creates its own - and
/// only rebuilds when [CartState.itemCount] changes, so add/remove/quantity
/// edits move the badge immediately. An empty cart shows the bare icon with
/// no badge. Tapping it pushes the existing cart route through GoRouter.
class CartButton extends StatelessWidget {
  const CartButton({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return BlocBuilder<CartCubit, CartState>(
      buildWhen: (previous, current) => previous.itemCount != current.itemCount,
      builder: (context, state) {
        return IconButton(
          tooltip: l10n.cartIconTooltip,
          onPressed: () => context.pushNamed(RouteNames.cart),
          icon: Badge(
            label: Text('${state.itemCount}'),
            isLabelVisible: state.itemCount > 0,
            child: const Icon(Icons.shopping_cart_outlined),
          ),
        );
      },
    );
  }
}
