import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/complaints/data/models/complaint_model.dart';
import 'package:phoenix/features/complaints/data/models/submit_complaint_args.dart';
import 'package:phoenix/features/complaints/presentation/managers/my_complaints_cubit.dart';
import 'package:phoenix/features/complaints/presentation/managers/my_complaints_state.dart';
import 'package:phoenix/features/complaints/presentation/widgets/complaint_list_tile.dart';
import 'package:phoenix/routes/route_names.dart';

// Section 1: the pharmacy's "My Complaints" screen - reached from the profile
// screen. Lists complaints the pharmacy filed, each opening its full detail;
// a clear "Submit a complaint" CTA is always on screen.
class MyComplaintsView extends StatefulWidget {
  const MyComplaintsView({super.key});

  @override
  State<MyComplaintsView> createState() => _MyComplaintsViewState();
}

class _MyComplaintsViewState extends State<MyComplaintsView> {
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
      context.read<MyComplaintsCubit>().loadMore();
    }
  }

  Future<void> _openSubmit(BuildContext context) async {
    // From "My Complaints" the CTA always files a GENERAL complaint (Section
    // 1/17). Warehouse- and order-context complaints are started from those
    // screens instead.
    final created = await context.pushNamed<bool>(
      RouteNames.submitComplaint,
      extra: const SubmitComplaintArgs.general(),
    );
    if (created == true && context.mounted) {
      context.read<MyComplaintsCubit>().load();
    }
  }

  Future<void> _openDetail(BuildContext context, ComplaintModel complaint) async {
    await context.pushNamed(
      RouteNames.complaintDetail,
      pathParameters: {'complaintId': complaint.id},
      // Seeds the detail screen for an instant first paint; it still refetches
      // for the freshest copy (and the admin responder's name).
      extra: complaint,
    );
    if (context.mounted) {
      // A visit to the detail may have surfaced a fresh admin response - keep
      // the list honest without a jarring full reload.
      context.read<MyComplaintsCubit>().load();
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
        title: BlocBuilder<MyComplaintsCubit, MyComplaintsState>(
          buildWhen: (previous, current) => previous.complaints.length != current.complaints.length,
          builder: (context, state) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.complaintsTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  l10n.complaintsCountSubtitle(state.complaints.length),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.normal,
                    color: Colors.white70,
                  ),
                ),
              ],
            );
          },
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: BlocConsumer<MyComplaintsCubit, MyComplaintsState>(
                listenWhen: (previous, current) =>
                    current.loadMoreErrorMessage != null &&
                    previous.loadMoreErrorMessage != current.loadMoreErrorMessage,
                listener: (context, state) {
                  AppSnackbar.show(
                    context,
                    translateErrorCode(l10n, state.loadMoreErrorCode, state.loadMoreErrorMessage!),
                    actionLabel: l10n.retryButton,
                    onAction: () => context.read<MyComplaintsCubit>().loadMore(),
                  );
                },
                builder: (context, state) {
                  if (state.status == MyComplaintsStatus.initial ||
                      (state.status == MyComplaintsStatus.loading && state.complaints.isEmpty)) {
                    return const AppLoading();
                  }
                  if (state.status == MyComplaintsStatus.error && state.complaints.isEmpty) {
                    return FailureWidget(
                      message: translateErrorCode(
                        l10n,
                        state.errorCode,
                        state.errorMessage ?? l10n.errorState,
                      ),
                      onRetry: () => context.read<MyComplaintsCubit>().load(),
                    );
                  }
                  if (state.complaints.isEmpty) {
                    return RefreshIndicator(
                      onRefresh: () => context.read<MyComplaintsCubit>().load(),
                      child: _EmptyComplaints(message: l10n.noComplaintsYet, hint: l10n.noComplaintsYetHint),
                    );
                  }

                  return RefreshIndicator(
                    onRefresh: () => context.read<MyComplaintsCubit>().load(),
                    child: ListView.separated(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(AppSizes.spacingMedium),
                      itemCount: state.complaints.length + 1,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSizes.spacingSmall),
                      itemBuilder: (context, index) {
                        if (index == state.complaints.length) {
                          return _PaginationFooter(
                            hasMore: state.hasMore,
                            isLoadingMore: state.isLoadingMore,
                          );
                        }
                        final complaint = state.complaints[index];
                        return ComplaintListTile(
                          complaint: complaint,
                          onTap: () => _openDetail(context, complaint),
                        );
                      },
                    ),
                  );
                },
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(
                AppSizes.spacingMedium,
                AppSizes.spacingSmall,
                AppSizes.spacingMedium,
                AppSizes.spacingMedium,
              ),
              decoration: BoxDecoration(
                color: AppColors.surfaceElevatedOf(context),
                border: Border(top: BorderSide(color: AppColors.borderOf(context))),
              ),
              child: PrimaryButton(
                label: l10n.submitComplaintCta,
                onPressed: () => _openSubmit(context),
              ),
            ),
          ],
        ),
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

class _EmptyComplaints extends StatelessWidget {
  const _EmptyComplaints({required this.message, required this.hint});

  final String message;
  final String hint;

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
                padding: const EdgeInsets.all(AppSizes.spacingXLarge),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 84,
                      height: 84,
                      decoration: BoxDecoration(
                        color: AppColors.surfaceOf(context),
                        borderRadius: AppRadius.large,
                      ),
                      child: Icon(
                        Icons.support_agent_outlined,
                        size: 40,
                        color: AppColors.textSecondaryOf(context),
                      ),
                    ),
                    const SizedBox(height: AppSizes.spacingMedium),
                    Text(message, style: context.textTheme.titleLarge, textAlign: TextAlign.center),
                    const SizedBox(height: AppSizes.spacingXSmall),
                    Text(
                      hint,
                      textAlign: TextAlign.center,
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: AppColors.textSecondaryOf(context),
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
