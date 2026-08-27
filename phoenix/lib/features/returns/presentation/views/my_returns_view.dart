import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/models/returnable_order_model.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_state.dart';
import 'package:phoenix/features/returns/presentation/widgets/request_return_sheet.dart';
import 'package:phoenix/features/returns/presentation/widgets/return_list_tile.dart';
import 'package:phoenix/routes/route_names.dart';

class MyReturnsView extends StatefulWidget {
  const MyReturnsView({super.key});

  @override
  State<MyReturnsView> createState() => _MyReturnsViewState();
}

class _MyReturnsViewState extends State<MyReturnsView> {
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
      context.read<MyReturnsCubit>().loadMore();
    }
  }

  Future<void> _edit(BuildContext context, ReturnModel returnRequest) async {
    final result = await showRequestReturnSheet(
      context,
      orderId: returnRequest.orderId,
      existingReturn: returnRequest,
    );
    if (result != null && context.mounted) {
      context.read<MyReturnsCubit>().load();
    }
  }

  // Reuses the same sheet the order-tracking screen opens - it loads the
  // order's own items from orderId, so nothing extra has to be threaded in.
  Future<void> _requestReturn(BuildContext context, ReturnableOrderModel order) async {
    final result = await showRequestReturnSheet(context, orderId: order.id);
    if (result != null && context.mounted) {
      context.read<MyReturnsCubit>().load();
    }
  }

  Future<void> _delete(BuildContext context, ReturnModel returnRequest) async {
    final l10n = context.l10n;
    final cubit = context.read<MyReturnsCubit>();

    await AppDialog.show(
      context: context,
      title: l10n.deleteReturnConfirmTitle,
      content: l10n.deleteReturnConfirmMessage,
      actionLabel: l10n.deleteReturnButton,
      // AppDialog's own action button already pops this confirmation dialog
      // - an extra Navigator.pop(context) here has nothing left of its own
      // to pop and throws, silently aborting this callback before delete()
      // ever runs.
      onAction: () => cubit.delete(returnRequest.id),
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
        title: BlocBuilder<MyReturnsCubit, MyReturnsState>(
          buildWhen: (previous, current) => previous.returns.length != current.returns.length,
          builder: (context, state) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.returnsTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  l10n.returnsCountSubtitle(state.returns.length),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.normal, color: Colors.white70),
                ),
              ],
            );
          },
        ),
      ),
      body: BlocConsumer<MyReturnsCubit, MyReturnsState>(
        listenWhen: (previous, current) =>
            current.loadMoreErrorMessage != null &&
            previous.loadMoreErrorMessage != current.loadMoreErrorMessage,
        listener: (context, state) {
          AppSnackbar.show(
            context,
            translateErrorCode(l10n, state.loadMoreErrorCode, state.loadMoreErrorMessage!),
            actionLabel: l10n.retryButton,
            onAction: () => context.read<MyReturnsCubit>().loadMore(),
          );
        },
        builder: (context, state) {
          if (state.status == MyReturnsStatus.initial ||
              (state.status == MyReturnsStatus.loading && state.returns.isEmpty)) {
            return const AppLoading();
          }
          if (state.status == MyReturnsStatus.error && state.returns.isEmpty) {
            return FailureWidget(
              message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
              onRetry: () => context.read<MyReturnsCubit>().load(),
            );
          }
          if (state.returns.isEmpty && state.returnableOrders.isEmpty) {
            return RefreshIndicator(
              onRefresh: () => context.read<MyReturnsCubit>().load(),
              child: _EmptyReturns(message: l10n.noReturnsYet),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<MyReturnsCubit>().load(),
            child: Builder(
              builder: (context) {
                // Built as an explicit list: the eligible-orders section
                // trails the paginated returns, and index arithmetic across
                // three different kinds of row is where this gets fragile.
                final rows = <Widget>[
                  if (state.returns.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingSmall),
                      child: Text(
                        l10n.noReturnsYet,
                        textAlign: TextAlign.center,
                        style: context.textTheme.bodyMedium?.copyWith(
                          color: AppColors.textSecondaryOf(context),
                        ),
                      ),
                    ),
                  for (final returnRequest in state.returns)
                    ReturnListTile(
                      returnRequest: returnRequest,
                      onEdit: returnRequest.isPending ? () => _edit(context, returnRequest) : null,
                      onDelete: returnRequest.isPending ? () => _delete(context, returnRequest) : null,
                      onViewReplacementOrder: returnRequest.replacementOrderId != null
                          ? () => context.pushNamed(
                              RouteNames.orderTracking,
                              pathParameters: {'orderId': returnRequest.replacementOrderId!},
                            )
                          : null,
                    ),
                  _PaginationFooter(hasMore: state.hasMore, isLoadingMore: state.isLoadingMore),
                  if (state.returnableOrders.isNotEmpty)
                    _ReturnableSection(
                      orders: state.returnableOrders,
                      onRequest: (order) => _requestReturn(context, order),
                    ),
                ];

                return ListView.separated(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(AppSizes.spacingMedium),
                  itemCount: rows.length,
                  separatorBuilder: (context, index) => const SizedBox(height: AppSizes.spacingSmall),
                  itemBuilder: (context, index) => rows[index],
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
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: AppSizes.spacingSmall),
        child: Center(
          child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
        ),
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

class _EmptyReturns extends StatelessWidget {
  const _EmptyReturns({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
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
                        Icons.assignment_return_outlined,
                        size: 40,
                        color: AppColors.textSecondaryOf(context),
                      ),
                    ),
                    const SizedBox(height: AppSizes.spacingMedium),
                    Text(message, style: context.textTheme.titleLarge, textAlign: TextAlign.center),
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

// Section: delivered orders still inside the 48-hour return window. Rendered
// only when there's at least one - an empty list hides the whole section
// (header included) rather than showing an empty shell.
class _ReturnableSection extends StatelessWidget {
  const _ReturnableSection({required this.orders, required this.onRequest});

  final List<ReturnableOrderModel> orders;
  final void Function(ReturnableOrderModel) onRequest;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSizes.spacingMedium),
        Divider(color: AppColors.borderOf(context), height: 1),
        const SizedBox(height: AppSizes.spacingMedium),
        Text(
          l10n.returnableSectionTitle,
          style: context.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: AppSizes.spacingXSmall),
        Text(
          l10n.returnableSectionSubtitle,
          style: context.textTheme.bodySmall?.copyWith(
            color: AppColors.textSecondaryOf(context),
          ),
        ),
        const SizedBox(height: AppSizes.spacingMedium),
        for (final order in orders) ...[
          _ReturnableOrderCard(order: order, onRequest: () => onRequest(order)),
          const SizedBox(height: AppSizes.spacingSmall),
        ],
      ],
    );
  }
}

class _ReturnableOrderCard extends StatelessWidget {
  const _ReturnableOrderCard({required this.order, required this.onRequest});

  final ReturnableOrderModel order;
  final VoidCallback onRequest;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    // Orange once the window is nearly up, so a card about to expire reads
    // differently at a glance from one with a day and a half left.
    final accent = order.isEndingSoon
        ? AppColors.primaryOf(context)
        : AppColors.navyOf(context);
    final warehouseName =
        (isArabic ? order.warehouseNameAr : order.warehouseNameEn) ??
        order.warehouseNameAr ??
        order.warehouseNameEn ??
        '';
    final shownItems = order.items.take(3).toList();
    final hiddenCount = order.items.length - shownItems.length;

    return Container(
      padding: const EdgeInsets.all(AppSizes.spacingMedium),
      decoration: BoxDecoration(
        color: AppColors.backgroundOf(context),
        borderRadius: AppRadius.large,
        border: Border.all(
          color: order.isEndingSoon ? accent : accent.withValues(alpha: 0.35),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.storefront_rounded, size: 18, color: AppColors.navyOf(context)),
              const SizedBox(width: AppSizes.spacingXSmall),
              Expanded(
                child: Text(
                  warehouseName,
                  style: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              Text(
                l10n.returnableOrderNumber('${order.orderNumber}'),
                style: context.textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          Divider(color: AppColors.borderOf(context), height: 1),
          const SizedBox(height: AppSizes.spacingSmall),
          Text(
            shownItems
                .map((item) => isArabic ? item.productNameAr : (item.productNameEn ?? item.productNameAr))
                .join('، '),
            style: context.textTheme.bodyMedium,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (hiddenCount > 0) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Text(
              l10n.returnableMoreItems('$hiddenCount'),
              style: context.textTheme.bodySmall?.copyWith(
                color: AppColors.textSecondaryOf(context),
              ),
            ),
          ],
          const SizedBox(height: AppSizes.spacingSmall),
          Text(
            '${order.finalPrice} ${l10n.currencySuffix}',
            style: context.textTheme.titleSmall?.copyWith(
              color: AppColors.navyOf(context),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          Row(
            children: [
              Icon(Icons.timer_outlined, size: 16, color: accent),
              const SizedBox(width: AppSizes.spacingXSmall),
              Text(
                l10n.returnableHoursLeft('${order.hoursRemaining}'),
                style: context.textTheme.bodySmall?.copyWith(
                  color: accent,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (order.isEndingSoon) ...[
                const SizedBox(width: AppSizes.spacingSmall),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    l10n.returnableEndingSoon,
                    style: context.textTheme.labelSmall?.copyWith(
                      color: accent,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: onRequest,
              icon: const Icon(Icons.assignment_return_rounded, size: 18),
              label: Text(l10n.returnableRequestButton),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.navyOf(context),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
