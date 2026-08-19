import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/core/widgets/secondary_price_hint.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_state.dart';
import 'package:phoenix/features/cart/presentation/utils/cart_error_translator.dart';
import 'package:phoenix/features/cart/presentation/widgets/cart_item_tile.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
import 'package:phoenix/routes/route_names.dart';

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

    if (state.errorCode == 'STOCK_CHECK_FAILED') {
      final problems = (state.errorDetails?['problems'] as List?)
          ?.cast<Map<String, dynamic>>();
      if (problems != null && problems.isNotEmpty) {
        final isArabic = Localizations.localeOf(context).languageCode == 'ar';
        return describeStockProblems(l10n, isArabic, problems, state.items);
      }
    }

    return translateErrorCode(
      l10n,
      state.errorCode,
      state.errorMessage ?? l10n.errorState,
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
        title: Text(l10n.cartTitle),
      ),
      body: BlocConsumer<CartCubit, CartState>(
        listenWhen: (previous, current) =>
            current.errorMessage != null &&
            previous.errorMessage != current.errorMessage,
        listener: (context, state) {
          AppDialog.show(
            context: context,
            title: l10n.errorState,
            content: _describeError(state),
          );
        },
        builder: (context, state) {
          if (state.isEmpty) {
            return EmptyView(message: l10n.cartEmptyMessage);
          }

          return Column(
            children: [
              Expanded(
                child: ListView.separated(
                  padding: AppPadding.screen,
                  itemCount: state.items.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: AppSizes.spacingSmall),
                  itemBuilder: (context, index) {
                    final item = state.items[index];
                    return CartItemTile(
                      item: item,
                      onQuantityChanged: (quantity) => context
                          .read<CartCubit>()
                          .updateQuantity(item.productId, quantity),
                      onRemove: () =>
                          context.read<CartCubit>().removeItem(item.productId),
                    );
                  },
                ),
              ),
              Padding(
                padding: AppPadding.screen,
                child: AppTextField(
                  label: l10n.notesLabel,
                  controller: _notesController,
                  onChanged: (value) =>
                      context.read<CartCubit>().updateNotes(value),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSizes.spacingLarge,
                ),
                child: Row(
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
                          final sypText = formatSypApprox(
                            state.subtotalUsd,
                            usdToSyp,
                            l10n.currencySuffix,
                          );
                          return Wrap(
                            alignment: WrapAlignment.end,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            spacing: AppSizes.spacingXSmall,
                            children: [
                              Text(
                                '\$${state.subtotalUsd}',
                                style: context.textTheme.titleMedium?.copyWith(
                                  color: AppColors.primaryOf(context),
                                ),
                              ),
                              if (sypText != null)
                                SecondaryPriceHint(text: sypText),
                            ],
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: AppPadding.screen,
                child: PrimaryButton(
                  label: l10n.submitOrderButton,
                  isLoading: state.isSubmitting,
                  onPressed: _confirmSubmit,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
