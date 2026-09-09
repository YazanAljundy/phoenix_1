import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_padding.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/error/error_translator.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/widgets/app_skeleton.dart';
import 'package:feniq/core/widgets/app_snackbar.dart';
import 'package:feniq/core/widgets/failure_widget.dart';
import 'package:feniq/features/cart/presentation/widgets/cart_button.dart';
import 'package:feniq/features/my_orders/presentation/managers/my_orders_cubit.dart';
import 'package:feniq/features/my_orders/presentation/managers/my_orders_state.dart';
import 'package:feniq/features/my_orders/presentation/widgets/order_list_tile.dart';
import 'package:feniq/routes/route_names.dart';

class MyOrdersView extends StatefulWidget {
  const MyOrdersView({super.key});

  @override
  State<MyOrdersView> createState() => _MyOrdersViewState();
}

class _MyOrdersViewState extends State<MyOrdersView> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (position.maxScrollExtent > 0 && position.pixels >= position.maxScrollExtent * 0.8) {
      context.read<MyOrdersCubit>().loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        toolbarHeight: 64,
        title: BlocBuilder<MyOrdersCubit, MyOrdersState>(
          buildWhen: (previous, current) => previous.orders.length != current.orders.length,
          builder: (context, state) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.myOrdersTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  l10n.myOrdersCountSubtitle(state.orders.length),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.normal, color: Colors.white70),
                ),
              ],
            );
          },
        ),
        // Same shared cart affordance as the shopping screens - the cart is
        // app-wide (one CartCubit at the root), so it stays reachable from
        // here too. CartButton reads that cubit; it never creates one.
        actions: const [
          Padding(padding: EdgeInsets.only(left: AppSizes.spacingSmall), child: _RefreshButton()),
          CartButton(),
        ],
      ),
      body: BlocConsumer<MyOrdersCubit, MyOrdersState>(
        listenWhen: (previous, current) =>
            current.loadMoreErrorMessage != null &&
            previous.loadMoreErrorMessage != current.loadMoreErrorMessage,
        listener: (context, state) {
          AppSnackbar.show(
            context,
            translateErrorCode(l10n, state.loadMoreErrorCode, state.loadMoreErrorMessage!),
            actionLabel: l10n.retryButton,
            onAction: () => context.read<MyOrdersCubit>().loadMore(),
          );
        },
        builder: (context, state) {
          if (state.status == MyOrdersStatus.initial ||
              (state.status == MyOrdersStatus.loading && state.orders.isEmpty)) {
            return const SkeletonCardList();
          }
          if (state.status == MyOrdersStatus.error && state.orders.isEmpty) {
            return FailureWidget(
              message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
              onRetry: () => context.read<MyOrdersCubit>().load(),
            );
          }
          if (state.orders.isEmpty) {
            return RefreshIndicator(
              onRefresh: () => context.read<MyOrdersCubit>().load(),
              child: _EmptyOrders(
                onBrowse: () => context.goNamed(RouteNames.warehouseSelection),
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<MyOrdersCubit>().load(),
            child: ListView.separated(
              controller: _scrollController,
              padding: AppPadding.screen,
              itemCount: state.orders.length + 1,
              separatorBuilder: (context, index) => const SizedBox(height: AppSizes.spacingSmall),
              itemBuilder: (context, index) {
                if (index == state.orders.length) {
                  return _PaginationFooter(hasMore: state.hasMore, isLoadingMore: state.isLoadingMore);
                }
                final order = state.orders[index];
                return OrderListTile(
                  order: order,
                  onTap: () => context.pushNamed(
                    RouteNames.orderTracking,
                    pathParameters: {'orderId': order.id},
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _PaginationFooter extends StatelessWidget {
  const _PaginationFooter({required this.hasMore, required this.isLoadingMore});

  final bool hasMore;
  final bool isLoadingMore;

  @override
  Widget build(BuildContext context) {
    if (isLoadingMore) {
      // One more card-shaped placeholder at the tail of the list, so the next
      // page arrives into the shape it is about to fill rather than under a
      // spinner.
      return const Padding(
        padding: EdgeInsets.only(top: AppSizes.spacingSmall),
        child: SkeletonPulse(child: SkeletonListCard()),
      );
    }
    if (!hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingSmall),
        child: Center(
          child: Text(
            context.l10n.noMoreResultsText,
            style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
          ),
        ),
      );
    }
    return const SizedBox.shrink();
  }
}

// A plain, working refresh action - re-runs the exact same load() the
// pull-to-refresh gesture triggers, just reachable without the swipe.
// Spins for the duration of an in-flight load, still for everything else.
class _RefreshButton extends StatefulWidget {
  const _RefreshButton();

  @override
  State<_RefreshButton> createState() => _RefreshButtonState();
}

class _RefreshButtonState extends State<_RefreshButton> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 1),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return BlocConsumer<MyOrdersCubit, MyOrdersState>(
      listenWhen: (previous, current) => previous.status != current.status,
      listener: (context, state) {
        if (state.status == MyOrdersStatus.loading) {
          _controller.repeat();
        } else {
          _controller.stop();
          _controller.value = 0;
        }
      },
      buildWhen: (previous, current) => false,
      builder: (context, state) {
        return IconButton(
          tooltip: l10n.refreshTooltip,
          onPressed: () => context.read<MyOrdersCubit>().load(),
          style: IconButton.styleFrom(
            backgroundColor: Colors.white.withValues(alpha: 0.12),
            foregroundColor: Colors.white,
          ),
          icon: RotationTransition(turns: _controller, child: const Icon(Icons.refresh)),
        );
      },
    );
  }
}

class _EmptyOrders extends StatelessWidget {
  const _EmptyOrders({required this.onBrowse});

  final VoidCallback onBrowse;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(
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
                        Icons.receipt_long_outlined,
                        size: 40,
                        color: AppColors.textSecondaryOf(context),
                      ),
                    ),
                    const SizedBox(height: AppSizes.spacingMedium),
                    Text(l10n.noOrdersYet, style: context.textTheme.titleLarge, textAlign: TextAlign.center),
                    const SizedBox(height: AppSizes.spacingLarge),
                    FilledButton(
                      onPressed: onBrowse,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primaryOf(context),
                        foregroundColor: Colors.white,
                        shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                        padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingLarge, vertical: 14),
                      ),
                      child: Text(l10n.browseWarehousesButton),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
