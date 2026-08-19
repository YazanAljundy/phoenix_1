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
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/error_view.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/core/widgets/secondary_button.dart';
import 'package:phoenix/core/widgets/whatsapp_button.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/order_tracking/presentation/managers/order_tracking_cubit.dart';
import 'package:phoenix/features/order_tracking/presentation/managers/order_tracking_state.dart';
import 'package:phoenix/features/order_tracking/presentation/widgets/order_invoice_section.dart';
import 'package:phoenix/features/order_tracking/presentation/widgets/order_progress_bar.dart';
import 'package:phoenix/features/order_tracking/presentation/widgets/status_history_list.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';
import 'package:phoenix/features/returns/presentation/widgets/request_return_sheet.dart';
import 'package:phoenix/routes/route_names.dart';

class OrderTrackingView extends StatefulWidget {
  const OrderTrackingView({super.key});

  @override
  State<OrderTrackingView> createState() => _OrderTrackingViewState();
}

class _OrderTrackingViewState extends State<OrderTrackingView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<OrderTrackingCubit>().load();
    });
  }

  Future<void> _requestReturn(String orderId) async {
    final l10n = context.l10n;
    final result = await showRequestReturnSheet(context, orderId: orderId);
    if (!mounted || result == null) return;
    context.read<OrderTrackingCubit>().load();
    await AppDialog.show(
      context: context,
      title: l10n.returnSubmittedTitle,
      content: l10n.returnSubmittedMessage,
    );
  }

  Future<void> _editReturn(String orderId, String returnId) async {
    final returns = await context.read<ReturnRepository>().getReturns();
    if (!mounted) return;
    ReturnModel? existing;
    for (final r in returns) {
      if (r.id == returnId) {
        existing = r;
        break;
      }
    }
    if (existing == null) return;
    final result = await showRequestReturnSheet(context, orderId: orderId, existingReturn: existing);
    if (!mounted || result == null) return;
    context.read<OrderTrackingCubit>().load();
  }

  Future<void> _deleteReturn(String returnId) async {
    final l10n = context.l10n;
    await AppDialog.show(
      context: context,
      title: l10n.deleteReturnConfirmTitle,
      content: l10n.deleteReturnConfirmMessage,
      actionLabel: l10n.deleteReturnButton,
      onAction: () async {
        Navigator.pop(context);
        await context.read<ReturnRepository>().deleteReturn(returnId);
        if (mounted) context.read<OrderTrackingCubit>().load();
      },
    );
  }

  Future<void> _confirmCancel() async {
    final l10n = context.l10n;
    final cubit = context.read<OrderTrackingCubit>();

    await AppDialog.show(
      context: context,
      title: l10n.cancelOrderTitle,
      content: l10n.cancelOrderConfirmation,
      actionLabel: l10n.cancelOrderButton,
      onAction: () {
        Navigator.pop(context);
        cubit.cancel();
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
        title: Text(l10n.orderTrackingTitle),
      ),
      body: BlocConsumer<OrderTrackingCubit, OrderTrackingState>(
        listenWhen: (previous, current) =>
            current.errorMessage != null && previous.errorMessage != current.errorMessage,
        listener: (context, state) {
          AppDialog.show(
            context: context,
            title: l10n.errorState,
            content: translateErrorCode(l10n, state.errorCode, state.errorMessage!),
          );
        },
        builder: (context, state) {
          if (state.status == OrderTrackingStatus.initial ||
              (state.status == OrderTrackingStatus.loading && state.order == null)) {
            return const AppLoading();
          }
          if (state.status == OrderTrackingStatus.error && state.order == null) {
            return ErrorView(
              message: translateErrorCode(
                l10n,
                state.errorCode,
                state.errorMessage ?? l10n.errorState,
              ),
              onRetry: () => context.read<OrderTrackingCubit>().load(),
            );
          }

          final order = state.order!;
          final isArabic = Localizations.localeOf(context).languageCode == 'ar';
          final warehouseName = isArabic ? order.warehouseNameAr : order.warehouseNameEn;

          return SingleChildScrollView(
            padding: AppPadding.screen,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  l10n.orderNumberLabel(order.orderNumber.toString()),
                  style: context.textTheme.titleLarge,
                ),
                if (warehouseName != null) ...[
                  const SizedBox(height: AppSizes.spacingXSmall),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          warehouseName,
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: AppColors.textSecondaryOf(context),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (state.warehousePhone != null)
                        WhatsAppButton(phone: state.warehousePhone!),
                    ],
                  ),
                ],
                const SizedBox(height: AppSizes.spacingXLarge),
                if (order.isCancelled)
                  _CancelledBanner(reason: order.cancelReason)
                else
                  OrderProgressBar(currentStageIndex: order.stageIndex),
                const SizedBox(height: AppSizes.spacingXLarge),
                Text(l10n.statusHistoryTitle, style: context.textTheme.titleMedium),
                const SizedBox(height: AppSizes.spacingSmall),
                StatusHistoryList(entries: order.statusHistory),
                if (order.items.isNotEmpty) ...[
                  const SizedBox(height: AppSizes.spacingXLarge),
                  OrderInvoiceSection(
                    items: order.items,
                    totalPrice: order.totalPrice,
                    discountAmount: order.discountAmount,
                    finalPrice: order.finalPrice,
                  ),
                ],
                if (order.status == 'delivered') ...[
                  const SizedBox(height: AppSizes.spacingMedium),
                  _ReturnStatusSection(
                    order: order,
                    onRequestReturn: () => _requestReturn(order.id),
                    onEdit: order.linkedReturn == null
                        ? null
                        : () => _editReturn(order.id, order.linkedReturn!.id),
                    onDelete: order.linkedReturn == null
                        ? null
                        : () => _deleteReturn(order.linkedReturn!.id),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  _WarehouseReviewSection(
                    myReview: order.myReview,
                    isSubmitting: state.isSubmittingReview,
                  ),
                ],
                if (order.isCancellable) ...[
                  const SizedBox(height: AppSizes.spacingXLarge),
                  SecondaryButton(
                    label: state.isCancelling ? l10n.loading : l10n.cancelOrderButton,
                    onPressed: state.isCancelling ? () {} : _confirmCancel,
                  ),
                ] else if (!order.isCancelled) ...[
                  const SizedBox(height: AppSizes.spacingXLarge),
                  Text(
                    l10n.contactWarehouseForChanges,
                    textAlign: TextAlign.center,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

// Section 6.9: the original order's invoice/tracking screen always shows its
// linked return's status - never left disconnected from the order. Renders
// one of three states: no return yet (a single "request a return" action for
// the whole order), a still-pending one (editable/deletable), or a decided
// one (approved with a link to its replacement order, or rejected with the
// warehouse's note).
class _ReturnStatusSection extends StatelessWidget {
  const _ReturnStatusSection({
    required this.order,
    required this.onRequestReturn,
    this.onEdit,
    this.onDelete,
  });

  final OrderModel order;
  final VoidCallback onRequestReturn;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final linkedReturn = order.linkedReturn;

    if (linkedReturn == null) {
      return PrimaryButton(label: l10n.requestReturnTitle, onPressed: onRequestReturn);
    }

    final Color color;
    final String bannerText;
    if (linkedReturn.isApproved) {
      color = AppColors.secondaryOf(context);
      bannerText = l10n.returnApprovedBanner;
    } else if (linkedReturn.isRejected) {
      color = AppColors.errorOf(context);
      bannerText = l10n.returnRejectedBanner;
    } else {
      color = AppColors.primaryOf(context);
      bannerText = l10n.returnPendingReviewBanner;
    }

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.assignment_return_outlined, color: color),
              const SizedBox(width: AppSizes.spacingSmall),
              Expanded(
                child: Text(
                  bannerText,
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          if (linkedReturn.isRejected && linkedReturn.rejectionNote != null) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSizes.spacingSmall),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.08),
                borderRadius: AppRadius.small,
              ),
              child: Text('${l10n.returnRejectionNoteLabel}: ${linkedReturn.rejectionNote}'),
            ),
          ],
          if (linkedReturn.isApproved && linkedReturn.replacementOrderId != null) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(
                onPressed: () => context.pushNamed(
                  RouteNames.orderTracking,
                  pathParameters: {'orderId': linkedReturn.replacementOrderId!},
                ),
                child: Text(l10n.viewReplacementOrderButton),
              ),
            ),
          ],
          if (linkedReturn.isPending) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (onEdit != null) TextButton(onPressed: onEdit, child: Text(l10n.editButton)),
                if (onDelete != null)
                  TextButton(
                    onPressed: onDelete,
                    style: TextButton.styleFrom(foregroundColor: AppColors.errorOf(context)),
                    child: Text(l10n.deleteReturnButton),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// Section 8/13c: rates the warehouse for this delivered order. Shows the
// interactive form (stars + optional comment) when the pharmacy hasn't
// reviewed this order yet, or a static "already rated" display when it has -
// same one-or-the-other pattern as _ReturnStatusSection above, just without
// the "in progress" middle state (a rating, once sent, can't be edited).
class _WarehouseReviewSection extends StatefulWidget {
  const _WarehouseReviewSection({required this.myReview, required this.isSubmitting});

  final MyReviewModel? myReview;
  final bool isSubmitting;

  @override
  State<_WarehouseReviewSection> createState() => _WarehouseReviewSectionState();
}

class _WarehouseReviewSectionState extends State<_WarehouseReviewSection> {
  int _rating = 0;
  late final TextEditingController _commentController;

  @override
  void initState() {
    super.initState();
    _commentController = TextEditingController();
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _confirmSubmit() async {
    final l10n = context.l10n;
    final cubit = context.read<OrderTrackingCubit>();
    final rating = _rating;
    final comment = _commentController.text.trim();

    await AppDialog.show(
      context: context,
      title: l10n.submitReviewConfirmTitle,
      content: l10n.submitReviewConfirmMessage,
      actionLabel: l10n.submitReviewButton,
      onAction: () {
        Navigator.pop(context);
        cubit.submitReview(rating: rating, comment: comment.isEmpty ? null : comment);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final myReview = widget.myReview;

    if (myReview != null) {
      return CustomCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.reviewThankYouTitle(myReview.rating.toString()), style: context.textTheme.titleMedium),
            const SizedBox(height: AppSizes.spacingSmall),
            _StarRatingRow(rating: myReview.rating),
            if (myReview.comment != null && myReview.comment!.isNotEmpty) ...[
              const SizedBox(height: AppSizes.spacingSmall),
              Text(myReview.comment!),
            ],
          ],
        ),
      );
    }

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.rateWarehouseTitle, style: context.textTheme.titleMedium),
          const SizedBox(height: AppSizes.spacingSmall),
          _StarRatingRow(rating: _rating, onRatingChanged: (r) => setState(() => _rating = r)),
          const SizedBox(height: AppSizes.spacingMedium),
          AppTextField(label: l10n.rateWarehouseCommentLabel, controller: _commentController),
          const SizedBox(height: AppSizes.spacingMedium),
          PrimaryButton(
            label: l10n.submitReviewButton,
            isLoading: widget.isSubmitting,
            onPressed: _rating > 0 ? _confirmSubmit : () {},
          ),
        ],
      ),
    );
  }
}

class _StarRatingRow extends StatelessWidget {
  const _StarRatingRow({required this.rating, this.onRatingChanged});

  final int rating;
  final ValueChanged<int>? onRatingChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        final starValue = index + 1;
        final filled = starValue <= rating;
        final icon = Icon(
          filled ? Icons.star : Icons.star_border,
          size: 32,
          color: filled ? AppColors.primaryOf(context) : AppColors.borderOf(context),
        );
        if (onRatingChanged == null) return icon;
        return InkWell(
          onTap: () => onRatingChanged!(starValue),
          borderRadius: BorderRadius.circular(20),
          child: icon,
        );
      }),
    );
  }
}

class _CancelledBanner extends StatelessWidget {
  const _CancelledBanner({this.reason});

  final String? reason;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSizes.spacingMedium),
      decoration: BoxDecoration(
        color: AppColors.errorOf(context).withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(Icons.cancel_outlined, color: AppColors.errorOf(context), size: 32),
          const SizedBox(height: AppSizes.spacingSmall),
          Text(
            l10n.orderCancelledMessage,
            textAlign: TextAlign.center,
            style: context.textTheme.titleMedium?.copyWith(color: AppColors.errorOf(context)),
          ),
          if (reason != null && reason!.isNotEmpty) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Text(reason!, textAlign: TextAlign.center),
          ],
        ],
      ),
    );
  }
}
