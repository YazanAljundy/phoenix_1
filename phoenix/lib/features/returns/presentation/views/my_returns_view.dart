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
import 'package:phoenix/core/widgets/error_view.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
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
            return ErrorView(
              message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
              onRetry: () => context.read<MyReturnsCubit>().load(),
            );
          }
          if (state.returns.isEmpty) {
            return RefreshIndicator(
              onRefresh: () => context.read<MyReturnsCubit>().load(),
              child: _EmptyReturns(message: l10n.noReturnsYet),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<MyReturnsCubit>().load(),
            child: ListView.separated(
              controller: _scrollController,
              padding: const EdgeInsets.all(AppSizes.spacingMedium),
              itemCount: state.returns.length + 1,
              separatorBuilder: (context, index) => const SizedBox(height: AppSizes.spacingSmall),
              itemBuilder: (context, index) {
                if (index == state.returns.length) {
                  return _PaginationFooter(hasMore: state.hasMore, isLoadingMore: state.isLoadingMore);
                }
                final returnRequest = state.returns[index];
                return ReturnListTile(
                  returnRequest: returnRequest,
                  onEdit: returnRequest.isPending ? () => _edit(context, returnRequest) : null,
                  onDelete: returnRequest.isPending ? () => _delete(context, returnRequest) : null,
                  onViewReplacementOrder: returnRequest.replacementOrderId != null
                      ? () => context.pushNamed(
                          RouteNames.orderTracking,
                          pathParameters: {'orderId': returnRequest.replacementOrderId!},
                        )
                      : null,
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
