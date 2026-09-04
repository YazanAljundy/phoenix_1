import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/models/returnable_order_model.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_cubit.dart';
import 'package:phoenix/features/returns/presentation/managers/my_returns_state.dart';
import 'package:phoenix/features/returns/presentation/widgets/request_return_sheet.dart';
import 'package:phoenix/features/returns/presentation/widgets/return_list_tile.dart';
import 'package:phoenix/routes/route_names.dart';

// Extra room under the scrolling content so the floating "Request Return"
// button never sits on top of the last card or a page-level empty/error
// state.
const double _kFabClearance = 96;

class MyReturnsView extends StatefulWidget {
  const MyReturnsView({super.key});

  @override
  State<MyReturnsView> createState() => _MyReturnsViewState();
}

class _MyReturnsViewState extends State<MyReturnsView> with SingleTickerProviderStateMixin {
  final _scrollController = ScrollController();
  // The two sections of this page - the pharmacy's own return requests and
  // the delivered orders still eligible for one - are shown as two tabs.
  // Held in the State so the selected tab survives cubit rebuilds.
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _tabController.dispose();
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

  // The floating "Request Return" action. It is only a new entry point into
  // the exact flow the eligible-order cards below already use (_requestReturn
  // -> showRequestReturnSheet): pick an order when there's more than one,
  // skip straight to the sheet when there's exactly one, and explain when
  // there are none.
  Future<void> _startReturnFromFab(BuildContext context) async {
    final l10n = context.l10n;
    final orders = context.read<MyReturnsCubit>().state.returnableOrders;

    if (orders.isEmpty) {
      AppSnackbar.show(context, l10n.noEligibleOrdersForReturn);
      return;
    }
    if (orders.length == 1) {
      await _requestReturn(context, orders.first);
      return;
    }

    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final selected = await showModalBottomSheet<ReturnableOrderModel>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSizes.spacingLarge,
                AppSizes.spacingSmall,
                AppSizes.spacingLarge,
                AppSizes.spacingSmall,
              ),
              child: Text(
                l10n.selectOrderForReturnTitle,
                style: sheetContext.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            for (final order in orders)
              ListTile(
                leading: Icon(Icons.storefront_outlined, color: AppColors.navyOf(sheetContext)),
                title: Text(l10n.returnableOrderNumber('${order.orderNumber}')),
                subtitle: Text(
                  (isArabic ? order.warehouseNameAr : order.warehouseNameEn) ??
                      order.warehouseNameAr ??
                      order.warehouseNameEn ??
                      '',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: Text(formatSyp(order.finalPrice, l10n.currencySuffix)),
                onTap: () => Navigator.pop(sheetContext, order),
              ),
          ],
        ),
      ),
    );
    if (selected != null && context.mounted) {
      await _requestReturn(context, selected);
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

  // Tab 1: the pharmacy's own return requests (paginated). Same list, same
  // per-row actions and same pull-to-refresh as before - only lifted into a
  // tab.
  Widget _buildMyReturnsTab(BuildContext context, MyReturnsState state) {
    if (state.returns.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => context.read<MyReturnsCubit>().load(),
        child: _EmptyReturns(onRequest: () => _startReturnFromFab(context)),
      );
    }

    final rows = <Widget>[
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
    ];

    return RefreshIndicator(
      onRefresh: () => context.read<MyReturnsCubit>().load(),
      child: ListView.separated(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          AppSizes.spacingMedium,
          AppSizes.spacingMedium,
          AppSizes.spacingMedium,
          _kFabClearance,
        ),
        itemCount: rows.length,
        separatorBuilder: (context, index) => const SizedBox(height: AppSizes.spacingSmall),
        itemBuilder: (context, index) => rows[index],
      ),
    );
  }

  // Tab 2: delivered orders still inside the 48-hour return window. Same
  // cards, same request action, same pull-to-refresh - only lifted into a
  // tab, with the section's supporting line kept as a lead-in.
  Widget _buildReturnableTab(BuildContext context, MyReturnsState state) {
    final l10n = context.l10n;

    if (state.returnableOrders.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => context.read<MyReturnsCubit>().load(),
        child: const _ReturnableEmpty(),
      );
    }

    return RefreshIndicator(
      onRefresh: () => context.read<MyReturnsCubit>().load(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          AppSizes.spacingMedium,
          AppSizes.spacingMedium,
          AppSizes.spacingMedium,
          _kFabClearance,
        ),
        children: [
          Text(
            l10n.returnableSectionSubtitle,
            style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          for (final order in state.returnableOrders) ...[
            _ReturnableOrderCard(order: order, onRequest: () => _requestReturn(context, order)),
            const SizedBox(height: AppSizes.spacingSmall),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      backgroundColor: AppColors.surfaceOf(context),
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
      // Section 6.9: the "Request Return" action, now a floating button at the
      // bottom of the screen instead of a per-card button. Hidden only during
      // the very first load, when there's nothing to act on yet.
      floatingActionButton: BlocBuilder<MyReturnsCubit, MyReturnsState>(
        buildWhen: (previous, current) => previous.status != current.status,
        builder: (context, state) {
          final firstLoad = state.status == MyReturnsStatus.initial ||
              (state.status == MyReturnsStatus.loading &&
                  state.returns.isEmpty &&
                  state.returnableOrders.isEmpty);
          if (firstLoad) return const SizedBox.shrink();
          return FloatingActionButton.extended(
            onPressed: () => _startReturnFromFab(context),
            backgroundColor: AppColors.primaryOf(context),
            foregroundColor: Colors.white,
            icon: const Icon(Icons.assignment_return_rounded),
            label: Text(l10n.requestReturnAction),
          );
        },
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
            return const _ReturnsLoadingList();
          }
          if (state.status == MyReturnsStatus.error && state.returns.isEmpty) {
            return Padding(
              padding: const EdgeInsets.only(bottom: _kFabClearance),
              child: FailureWidget(
                message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
                onRetry: () => context.read<MyReturnsCubit>().load(),
              ),
            );
          }

          // The two sections are now tabs - only the active tab's content is
          // shown. Both read the same already-loaded state.
          return Column(
            children: [
              _ReturnsTabBar(controller: _tabController),
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    _buildMyReturnsTab(context, state),
                    _buildReturnableTab(context, state),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

// The two-tab selector at the top of the page - navy indicator + navy active
// label on the app's surface, matching the rest of the Phoenix palette in
// both light and dark mode. Labels wrap to two lines rather than clip on a
// narrow phone.
class _ReturnsTabBar extends StatelessWidget {
  const _ReturnsTabBar({required this.controller});

  final TabController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Material(
      color: AppColors.backgroundOf(context),
      child: TabBar(
        controller: controller,
        labelColor: AppColors.navyOf(context),
        unselectedLabelColor: AppColors.textSecondaryOf(context),
        indicatorColor: AppColors.navyOf(context),
        indicatorWeight: 3,
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: AppColors.borderOf(context),
        labelStyle: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
        unselectedLabelStyle: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
        tabs: [
          Tab(
            height: 52,
            child: Text(
              l10n.myReturnsListSectionTitle,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Tab(
            height: 52,
            child: Text(
              l10n.returnableSectionTitle,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
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

// Tab 1's empty state: a friendly icon, a short title, one line of
// explanation and the same "Request Return" action the FAB triggers.
class _EmptyReturns extends StatelessWidget {
  const _EmptyReturns({required this.onRequest});

  final VoidCallback onRequest;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSizes.spacingLarge,
                AppSizes.spacingLarge,
                AppSizes.spacingLarge,
                _kFabClearance + AppSizes.spacingLarge,
              ),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 96,
                      height: 96,
                      decoration: BoxDecoration(
                        color: AppColors.navyOf(context).withValues(alpha: 0.08),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.assignment_return_outlined,
                        size: 44,
                        color: AppColors.navyOf(context),
                      ),
                    ),
                    const SizedBox(height: AppSizes.spacingMedium),
                    Text(
                      l10n.noReturnsYet,
                      style: context.textTheme.titleLarge,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSizes.spacingSmall),
                    Text(
                      l10n.noReturnsYetHint,
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSizes.spacingLarge),
                    FilledButton.icon(
                      onPressed: onRequest,
                      icon: const Icon(Icons.assignment_return_rounded, size: 18),
                      label: Text(l10n.requestReturnAction),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primaryOf(context),
                        foregroundColor: Colors.white,
                        shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSizes.spacingLarge,
                          vertical: 14,
                        ),
                      ),
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

// Tab 2's empty state: no delivered order is currently inside the return
// window. Scrollable so pull-to-refresh still works on a short screen.
class _ReturnableEmpty extends StatelessWidget {
  const _ReturnableEmpty();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSizes.spacingLarge,
                AppSizes.spacingLarge,
                AppSizes.spacingLarge,
                _kFabClearance + AppSizes.spacingLarge,
              ),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 96,
                      height: 96,
                      decoration: BoxDecoration(
                        color: AppColors.navyOf(context).withValues(alpha: 0.08),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.autorenew_rounded,
                        size: 44,
                        color: AppColors.navyOf(context),
                      ),
                    ),
                    const SizedBox(height: AppSizes.spacingMedium),
                    Text(
                      l10n.noReturnableOrdersTitle,
                      style: context.textTheme.titleLarge,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSizes.spacingSmall),
                    Text(
                      l10n.returnableSectionSubtitle,
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                      textAlign: TextAlign.center,
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

// The first-load placeholder - card-shaped pulsing blocks instead of a bare
// spinner, matching the shape of the returns list that replaces it. Mirrors
// the My Orders screen's skeleton so the two list pages load the same way.
class _ReturnsLoadingList extends StatefulWidget {
  const _ReturnsLoadingList();

  @override
  State<_ReturnsLoadingList> createState() => _ReturnsLoadingListState();
}

class _ReturnsLoadingListState extends State<_ReturnsLoadingList>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      key: const ValueKey('returnsLoadingSkeleton'),
      padding: const EdgeInsets.fromLTRB(
        AppSizes.spacingMedium,
        AppSizes.spacingMedium,
        AppSizes.spacingMedium,
        _kFabClearance,
      ),
      itemCount: 4,
      separatorBuilder: (context, index) => const SizedBox(height: AppSizes.spacingSmall),
      itemBuilder: (context, index) => _SkeletonCard(controller: _controller),
    );
  }
}

class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard({required this.controller});

  final AnimationController controller;

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween<double>(begin: 0.45, end: 1.0).animate(controller),
      child: Container(
        padding: const EdgeInsets.all(AppSizes.spacingMedium),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevatedOf(context),
          borderRadius: AppRadius.large,
          border: Border.all(color: AppColors.borderOf(context)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                _SkeletonBar(width: 96, height: 12, context: context),
                const Spacer(),
                _SkeletonBar(width: 72, height: 22, radius: AppRadius.full, context: context),
              ],
            ),
            const SizedBox(height: AppSizes.spacingMedium),
            _SkeletonBar(height: 14, context: context),
            const SizedBox(height: AppSizes.spacingSmall),
            _SkeletonBar(width: 160, height: 14, context: context),
            const SizedBox(height: AppSizes.spacingMedium),
            _SkeletonBar(width: 110, height: 12, context: context),
          ],
        ),
      ),
    );
  }
}

class _SkeletonBar extends StatelessWidget {
  const _SkeletonBar({
    required this.height,
    required this.context,
    this.width,
    this.radius = AppRadius.small,
  });

  final double? width;
  final double height;
  final BorderRadius radius;
  // Named `context` so the theme is read from the parent build - this is a
  // plain data widget, not overriding BuildContext.
  final BuildContext context;

  @override
  Widget build(BuildContext _) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(color: AppColors.surfaceOf(context), borderRadius: radius),
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
    final itemsText = shownItems
        .map((item) => isArabic ? item.productNameAr : (item.productNameEn ?? item.productNameAr))
        .join(isArabic ? '، ' : ', ');

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surfaceElevatedOf(context),
        borderRadius: AppRadius.large,
        border: Border.all(
          color: order.isEndingSoon
              ? accent.withValues(alpha: 0.6)
              : AppColors.borderOf(context),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // A thin accent strip pins the card's urgency to its top edge.
          Container(height: 3, color: accent),
          Padding(
            padding: const EdgeInsets.all(AppSizes.spacingMedium),
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
                        style: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: AppSizes.spacingSmall),
                    _OrderNumberPill(label: l10n.returnableOrderNumber('${order.orderNumber}')),
                  ],
                ),
                const SizedBox(height: AppSizes.spacingXSmall),
                Row(
                  children: [
                    Icon(Icons.event_outlined, size: 14, color: AppColors.textSecondaryOf(context)),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        l10n.returnableDeliveredOnLabel(DateFormatter.formatDate(order.deliveredAt)),
                        style: context.textTheme.bodySmall?.copyWith(
                          color: AppColors.textSecondaryOf(context),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSizes.spacingSmall),
                Divider(color: AppColors.borderOf(context), height: 1),
                const SizedBox(height: AppSizes.spacingSmall),
                if (itemsText.isNotEmpty)
                  Text(
                    itemsText,
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
                const SizedBox(height: AppSizes.spacingMedium),
                Text(
                  formatSyp(order.finalPrice, l10n.currencySuffix),
                  style: context.textTheme.titleSmall?.copyWith(
                    color: AppColors.navyOf(context),
                    fontWeight: FontWeight.w800,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSizes.spacingSmall),
                Row(
                  children: [
                    Icon(Icons.timer_outlined, size: 16, color: accent),
                    const SizedBox(width: AppSizes.spacingXSmall),
                    Flexible(
                      child: Text(
                        l10n.returnableHoursLeft('${order.hoursRemaining}'),
                        style: context.textTheme.bodySmall?.copyWith(
                          color: accent,
                          fontWeight: FontWeight.w700,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (order.isEndingSoon) ...[
                      const SizedBox(width: AppSizes.spacingSmall),
                      StatusBadge(
                        label: l10n.returnableEndingSoon,
                        tone: StatusBadgeTone.pending,
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
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OrderNumberPill extends StatelessWidget {
  const _OrderNumberPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.surfaceOf(context),
        borderRadius: AppRadius.full,
        border: Border.all(color: AppColors.borderOf(context)),
      ),
      child: Text(
        label,
        style: context.textTheme.bodySmall?.copyWith(
          color: AppColors.textSecondaryOf(context),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
