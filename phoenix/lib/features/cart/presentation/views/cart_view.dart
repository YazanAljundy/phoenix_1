import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_padding.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/error/error_translator.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/theme/app_text_theme.dart';
import 'package:feniq/core/utils/currency_formatter.dart';
import 'package:feniq/core/widgets/app_dialog.dart';
import 'package:feniq/core/widgets/app_text_field.dart';
import 'package:feniq/core/widgets/primary_button.dart';
import 'package:feniq/features/cart/presentation/managers/cart_cubit.dart';
import 'package:feniq/features/cart/presentation/managers/cart_state.dart';
import 'package:feniq/features/cart/presentation/utils/cart_error_translator.dart';
import 'package:feniq/features/cart/presentation/widgets/cart_item_tile.dart';
import 'package:feniq/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:feniq/routes/route_names.dart';

class CartView extends StatefulWidget {
  const CartView({super.key});

  @override
  State<CartView> createState() => _CartViewState();
}

class _CartViewState extends State<CartView> {
  late final TextEditingController _notesController;

  @override
  void initState() {
    super.initState();
    _notesController = TextEditingController(
      text: context.read<CartCubit>().state.notes,
    );
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  String _describeError(CartState state) {
    final l10n = context.l10n;

    // The refused packages are already flagged on their lines by the time this
    // runs (CartCubit.submitOrder), so their names come off the cart itself.
    if (state.errorCode == 'PACKAGE_UNAVAILABLE') {
      final isArabic = Localizations.localeOf(context).languageCode == 'ar';
      return describeUnavailablePackages(l10n, isArabic, state.items);
    }

    if (state.errorCode == 'STOCK_CHECK_FAILED') {
      final problems = (state.errorDetails?['problems'] as List?)
          ?.cast<Map<String, dynamic>>();
      if (problems != null && problems.isNotEmpty) {
        final isArabic = Localizations.localeOf(context).languageCode == 'ar';
        return describeStockProblems(l10n, isArabic, problems, state.items);
      }
    }

    // The server sends the limit back in details (order.service.js) so the
    // rejection reads with the real figure even though the English message
    // it ships with is only a fallback. The limit is USD-denominated on the
    // server; shown in SYP here at the live rate, like every other amount.
    final usdToSyp = context.read<ExchangeRateCubit>().state.usdToSyp;

    // Same per-item shape as STOCK_CHECK_FAILED, but the prices inside it are
    // USD (the catalog's native currency) and are shown in SYP here, so this
    // one needs the rate that was just read above.
    if (state.errorCode == 'PRICE_CHANGED') {
      final problems = (state.errorDetails?['problems'] as List?)
          ?.cast<Map<String, dynamic>>();
      if (problems != null && problems.isNotEmpty) {
        final isArabic = Localizations.localeOf(context).languageCode == 'ar';
        return describePriceProblems(
          l10n,
          isArabic,
          problems,
          state.items,
          (amount) => formatMoneyFromUsd(amount, usdToSyp, l10n.currencySuffix),
        );
      }
    }
    if (state.errorCode == 'ORDER_BELOW_MINIMUM') {
      final amount = state.errorDetails?['minOrderAmountUsd'];
      if (amount is num) {
        return l10n.orderBelowMinimum(formatMoneyFromUsd(amount, usdToSyp, l10n.currencySuffix));
      }
    }
    if (state.errorCode == 'ORDER_ABOVE_MAXIMUM') {
      final amount = state.errorDetails?['maxOrderAmountUsd'];
      if (amount is num) {
        return l10n.orderAboveMaximum(formatMoneyFromUsd(amount, usdToSyp, l10n.currencySuffix));
      }
    }

    return translateErrorCode(
      l10n,
      state.errorCode,
      state.errorMessage ?? l10n.errorState,
    );
  }

  // Empties the whole cart in one step, behind a confirmation - it drops
  // every line, the warehouse binding and any package along with them, so it
  // is not something to trigger by a stray tap. Purely local: nothing is sent
  // to the server, the cart has no server-side existence until submitOrder.
  Future<void> _confirmClearCart() async {
    final l10n = context.l10n;
    final cubit = context.read<CartCubit>();

    await AppDialog.show(
      context: context,
      title: l10n.clearCartTitle,
      content: l10n.clearCartConfirmation,
      actionLabel: l10n.clearCartButton,
      onAction: () {
        cubit.clearCart();
        // The notes field is uncontrolled by the cubit (the controller is
        // seeded once in initState), so clearing the state's notes has to
        // clear the controller too or a stale draft would come back with the
        // next item added.
        _notesController.clear();
      },
    );
  }

  Future<void> _confirmSubmit() async {
    final l10n = context.l10n;
    final cubit = context.read<CartCubit>();
    final warehouseName = cubit.state.warehouseName ?? '';

    await AppDialog.show(
      context: context,
      title: l10n.submitOrderTitle,
      content: l10n.submitOrderConfirmation(warehouseName),
      actionLabel: l10n.submitOrderButton,
      onAction: () async {
        // AppDialog's own action button already pops this confirmation
        // dialog (via dialogContext + rootNavigator) before calling here -
        // an extra Navigator.pop(context) with this outer context popped
        // CartView itself, which is why the screen used to never actually
        // reach the navigation below (mounted went false mid-flight).
        final order = await cubit.submitOrder();
        if (!mounted) return;

        // Straight to order tracking on success - no intermediate "order
        // submitted" dialog to tap through, the tracking screen itself is
        // the confirmation.
        if (order != null) {
          context.goNamed(
            RouteNames.orderTracking,
            pathParameters: {'orderId': order.id},
          );
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        toolbarHeight: 64,
        title: BlocBuilder<CartCubit, CartState>(
          buildWhen: (previous, current) =>
              previous.itemCount != current.itemCount ||
              previous.warehouseName != current.warehouseName,
          builder: (context, state) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.cartTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                if (state.warehouseName != null)
                  Text(
                    '${state.warehouseName} · ${l10n.catalogItemsCountSubtitle(state.itemCount)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.normal, color: Colors.white70),
                  ),
              ],
            );
          },
        ),
      ),
      body: BlocConsumer<CartCubit, CartState>(
        listenWhen: (previous, current) =>
            current.errorMessage != null &&
            previous.errorMessage != current.errorMessage,
        listener: (context, state) {
          // A refused package gets its way out right in the dialog: one tap
          // removes every package the server turned away, instead of the
          // pharmacist hunting down each flagged line.
          final cubit = context.read<CartCubit>();
          final hasRefusedPackages = state.errorCode == 'PACKAGE_UNAVAILABLE' &&
              state.items.any((item) => item.isPackage && !item.isAvailable);
          AppDialog.show(
            context: context,
            title: hasRefusedPackages ? l10n.advertisementUnavailableTitle : l10n.errorState,
            content: _describeError(state),
            actionLabel: hasRefusedPackages ? l10n.removeUnavailablePackagesButton : null,
            onAction: hasRefusedPackages ? cubit.removeUnavailablePackages : null,
          );
        },
        builder: (context, state) {
          if (state.isEmpty) {
            return _EmptyCart(onBrowse: () => context.goNamed(RouteNames.warehouseSelection));
          }

          // The warehouse's order-size limits are USD-denominated on the
          // server (order.service.js); shown here in SYP at the live rate,
          // consistent with the subtotal they're compared against.
          final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
          String limitText(num usdAmount) =>
              formatMoneyFromUsd(usdAmount, usdToSyp, l10n.currencySuffix);

          return Column(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  padding: AppPadding.screen,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final item in state.items) ...[
                        CartItemTile(
                          item: item,
                          // A package line's quantity is its copy count, and
                          // its contents are not lines - so both callbacks are
                          // the same for a package as for a product.
                          onQuantityChanged: (quantity) =>
                              context.read<CartCubit>().updateQuantity(item.lineKey, quantity),
                          onRemove: () => context.read<CartCubit>().removeItem(item.lineKey),
                        ),
                        const SizedBox(height: AppSizes.spacingSmall),
                      ],
                      const SizedBox(height: AppSizes.spacingXSmall),
                      // Section 5: add more products to this cart. Scoped to
                      // the cart's own warehouse - the existing warehouse ->
                      // manufacturers -> catalog flow, entered at the cart's
                      // warehouseId, so a company from another warehouse can
                      // never be reached for this cart.
                      OutlinedButton.icon(
                        onPressed: state.warehouseId == null
                            ? null
                            : () => context.pushNamed(
                                  RouteNames.manufacturers,
                                  pathParameters: {'warehouseId': state.warehouseId!},
                                  extra: ManufacturersRouteArgs(
                                    warehouseName: state.warehouseName ?? '',
                                  ),
                                ),
                        icon: const Icon(Icons.add, size: 18),
                        label: Text(l10n.addProductButton),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.navyOf(context),
                          side: BorderSide(color: AppColors.navyOf(context)),
                          shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                      const SizedBox(height: AppSizes.spacingSmall),
                      // Only ever rendered with a non-empty cart: the empty
                      // cart takes the _EmptyCart branch above, so there is
                      // nothing to clear when this is not on screen.
                      OutlinedButton.icon(
                        onPressed: _confirmClearCart,
                        icon: const Icon(Icons.delete_outline, size: 18),
                        label: Text(l10n.clearCartButton),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.errorOf(context),
                          side: BorderSide(color: AppColors.errorOf(context)),
                          shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                      const SizedBox(height: AppSizes.spacingMedium),
                      AppTextField(
                        label: l10n.notesLabel,
                        controller: _notesController,
                        maxLines: 3,
                        onChanged: (value) =>
                            context.read<CartCubit>().updateNotes(value),
                      ),
                    ],
                  ),
                ),
              ),
              Container(
                padding: AppPadding.screen,
                decoration: BoxDecoration(
                  color: AppColors.backgroundOf(context),
                  border: Border(top: BorderSide(color: AppColors.borderOf(context))),
                ),
                child: SafeArea(
                  top: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Flexible(
                            child: Text(
                              l10n.subtotalLabel,
                              style: context.textTheme.titleMedium,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Flexible(
                            child: Builder(
                              builder: (context) {
                                final usdToSyp = context
                                    .watch<ExchangeRateCubit>()
                                    .state
                                    .usdToSyp;
                                return Text(
                                  formatMoneyFromUsd(
                                    state.subtotalUsd,
                                    usdToSyp,
                                    l10n.currencySuffix,
                                  ),
                                  textAlign: TextAlign.end,
                                  style: context.textTheme.titleLarge?.copyWith(
                                    color: AppColors.primaryOf(context),
                                  ),
                                );
                              },
                            ),
                          ),
                        ],
                      ),
                      // Section: this warehouse's order-size limits. Shown
                      // against the subtotal above - the same figure the
                      // backend checks (order.service.js) - so the hint, the
                      // button state and the server all agree. A warehouse
                      // with no limits set renders nothing extra at all.
                      if (state.minOrderAmountUsd > 0 || state.maxOrderAmountUsd != null) ...[
                        const SizedBox(height: AppSizes.spacingXSmall),
                        if (state.minOrderAmountUsd > 0)
                          Text(
                            l10n.minOrderLabel(limitText(state.minOrderAmountUsd)),
                            style: context.textTheme.bodySmall?.copyWith(
                              color: state.isBelowMinimum
                                  ? AppColors.primaryOf(context)
                                  : AppColors.textSecondaryOf(context),
                              fontWeight: state.isBelowMinimum ? AppTextTheme.semiBold : null,
                            ),
                          ),
                        if (state.maxOrderAmountUsd != null)
                          Text(
                            l10n.maxOrderLabel(limitText(state.maxOrderAmountUsd!)),
                            style: context.textTheme.bodySmall?.copyWith(
                              color: state.isAboveMaximum
                                  ? AppColors.errorOf(context)
                                  : AppColors.textSecondaryOf(context),
                              fontWeight: state.isAboveMaximum ? AppTextTheme.semiBold : null,
                            ),
                          ),
                      ],
                      if (state.isBelowMinimum || state.isAboveMaximum) ...[
                        const SizedBox(height: AppSizes.spacingXSmall),
                        Text(
                          state.isBelowMinimum
                              ? l10n.addMoreToReachMinimum(limitText(state.amountToReachMinimum))
                              : l10n.removeToMeetMaximum(limitText(state.maxOrderAmountUsd!)),
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: state.isBelowMinimum
                                ? AppColors.primaryOf(context)
                                : AppColors.errorOf(context),
                            fontWeight: AppTextTheme.semiBold,
                          ),
                        ),
                      ],
                      const SizedBox(height: AppSizes.spacingSmall),
                      PrimaryButton(
                        label: l10n.submitOrderButton,
                        isLoading: state.isSubmitting,
                        // Blocked locally so the pharmacist sees why before
                        // spending a round trip; order.service.js enforces
                        // the same rule regardless (double validation).
                        onPressed: state.canSubmit ? _confirmSubmit : null,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _EmptyCart extends StatelessWidget {
  const _EmptyCart({required this.onBrowse});

  final VoidCallback onBrowse;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Center(
      child: Padding(
        padding: AppPadding.screen,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 84,
              height: 84,
              decoration: BoxDecoration(color: AppColors.surfaceOf(context), borderRadius: AppRadius.large),
              child: Icon(
                Icons.remove_shopping_cart_outlined,
                size: 40,
                color: AppColors.textSecondaryOf(context),
              ),
            ),
            const SizedBox(height: AppSizes.spacingMedium),
            Text(l10n.cartEmptyMessage, style: context.textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: AppSizes.spacingXSmall),
            Text(
              l10n.cartEmptyHint,
              textAlign: TextAlign.center,
              style: context.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondaryOf(context)),
            ),
            const SizedBox(height: AppSizes.spacingLarge),
            FilledButton(
              onPressed: onBrowse,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primaryOf(context),
                foregroundColor: Colors.white,
                shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingLarge, vertical: 14),
              ),
              child: Text(l10n.browseCatalogButton),
            ),
          ],
        ),
      ),
    );
  }
}
