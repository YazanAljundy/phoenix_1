import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/core/widgets/whatsapp_button.dart';
import 'package:phoenix/features/cart/data/models/order_model.dart';
import 'package:phoenix/features/cart/presentation/utils/order_status_label.dart';
import 'package:phoenix/features/cart/presentation/widgets/reorder_button.dart';
import 'package:phoenix/features/complaints/data/models/submit_complaint_args.dart';
import 'package:phoenix/features/complaints/presentation/utils/complaint_labels.dart';
import 'package:phoenix/features/order_tracking/presentation/managers/order_tracking_cubit.dart';
import 'package:phoenix/features/order_tracking/presentation/managers/order_tracking_state.dart';
import 'package:phoenix/features/order_tracking/presentation/widgets/delivery_seal_section.dart';
import 'package:phoenix/features/order_tracking/presentation/widgets/order_invoice_section.dart';
import 'package:phoenix/features/order_tracking/presentation/widgets/order_progress_bar.dart';
import 'package:phoenix/features/order_tracking/presentation/widgets/status_history_list.dart';
import 'package:phoenix/features/returns/data/models/return_model.dart';
import 'package:phoenix/features/returns/data/repositories/return_repository.dart';
import 'package:phoenix/features/returns/presentation/widgets/request_return_sheet.dart';
import 'package:phoenix/core/widgets/status_badge.dart';
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
    // getReturns() is cursor-paginated now (Section: cursor pagination) -
    // paged through here rather than capped at the first page, since the
    // one return being looked for could be sitting on any page.
    final returnRepository = context.read<ReturnRepository>();
    ReturnModel? existing;
    String? cursor;
    while (existing == null) {
      final result = await returnRepository.getReturns(after: cursor);
      for (final r in result.items) {
        if (r.id == returnId) {
          existing = r;
          break;
        }
      }
      if (existing != null || !result.hasMore || result.nextCursor == null) break;
      cursor = result.nextCursor;
    }
    if (!mounted) return;
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
      // AppDialog's own action button already pops this confirmation dialog
      // (via dialogContext + rootNavigator) before calling here - an extra
      // Navigator.pop(context) with this outer context has nothing left of
      // its own to pop and throws, which silently aborts this callback
      // before deleteReturn() ever runs (see cart_view.dart's _confirmSubmit
      // for the same fix applied earlier).
      onAction: () async {
        try {
          await context.read<ReturnRepository>().deleteReturn(returnId);
          if (mounted) context.read<OrderTrackingCubit>().load();
        } on Failure catch (f) {
          if (!mounted) return;
          await AppDialog.show(
            context: context,
            title: l10n.errorState,
            content: translateErrorCode(l10n, f.code, f.errMessage),
          );
        } catch (e) {
          if (!mounted) return;
          await AppDialog.show(context: context, title: l10n.errorState, content: l10n.errorState);
        }
      },
    );
  }

  // Complaint Section 9: "file a complaint about THIS order" - the context
  // (order id) is passed through; the pharmacist never re-picks a warehouse or
  // types an order number, and the backend resolves the warehouse from the
  // order. On return the tracking screen reloads so a just-filed complaint
  // shows in the section immediately.
  Future<void> _fileOrderComplaint(OrderModel order) async {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final created = await context.pushNamed<bool>(
      RouteNames.submitComplaint,
      extra: SubmitComplaintArgs.order(
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderWarehouseName: isArabic ? order.warehouseNameAr : order.warehouseNameEn,
      ),
    );
    if (created == true && mounted) {
      context.read<OrderTrackingCubit>().load();
    }
  }

  Future<void> _confirmCancel() async {
    final l10n = context.l10n;
    final cubit = context.read<OrderTrackingCubit>();

    await AppDialog.show(
      context: context,
      title: l10n.cancelOrderTitle,
      content: l10n.cancelOrderConfirmation,
      actionLabel: l10n.cancelOrderButton,
      // See _deleteReturn above - AppDialog already pops the dialog itself,
      // an extra pop here throws and short-circuits before cubit.cancel()
      // ever runs (the "cancel order freezes" report this fixes).
      onAction: () => cubit.cancel(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return BlocConsumer<OrderTrackingCubit, OrderTrackingState>(
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
        final order = state.order;
        final isArabic = Localizations.localeOf(context).languageCode == 'ar';

        return Scaffold(
          appBar: AppBar(
            backgroundColor: AppColors.navyOf(context),
            foregroundColor: Colors.white,
            toolbarHeight: order != null ? 64 : kToolbarHeight,
            title: order == null
                ? Text(l10n.orderTrackingTitle)
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.orderNumberLabel(order.orderNumber.toString()),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        [
                          if ((isArabic ? order.warehouseNameAr : order.warehouseNameEn) != null)
                            (isArabic ? order.warehouseNameAr : order.warehouseNameEn)!,
                          if (order.createdAt != null) DateFormatter.formatDate(order.createdAt!),
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.normal, color: Colors.white70),
                      ),
                    ],
                  ),
            actions: [
              if (state.warehousePhone != null)
                Padding(
                  padding: const EdgeInsets.only(left: AppSizes.spacingSmall),
                  child: WhatsAppButton(phone: state.warehousePhone!),
                ),
            ],
          ),
          body: _buildBody(context, state),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, OrderTrackingState state) {
    final l10n = context.l10n;

    if (state.status == OrderTrackingStatus.initial ||
        (state.status == OrderTrackingStatus.loading && state.order == null)) {
      return const AppLoading();
    }
    if (state.status == OrderTrackingStatus.error && state.order == null) {
      return FailureWidget(
        message: translateErrorCode(
          l10n,
          state.errorCode,
          state.errorMessage ?? l10n.errorState,
        ),
        onRetry: () => context.read<OrderTrackingCubit>().load(),
      );
    }

    final order = state.order!;

    return SingleChildScrollView(
      padding: AppPadding.screen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (order.isCancelled)
            _CancelledBanner(reason: order.cancelReason)
          else ...[
            CustomCard(child: OrderProgressBar(currentStageIndex: order.stageIndex)),
            const SizedBox(height: AppSizes.spacingMedium),
            _CurrentStatusHighlight(order: order),
          ],
          // Section: optional delivery seal photo - only when this order's
          // warehouse asks for one (and it's not been provided yet) or once it
          // has. Confirming attaches the photo; it never advances the order.
          if (!order.isCancelled &&
              (order.needsDeliverySealConfirmation || order.deliverySealPhotoUrl != null)) ...[
            const SizedBox(height: AppSizes.spacingMedium),
            DeliverySealSection(order: order, isConfirming: state.isConfirmingDelivery),
          ],
          const SizedBox(height: AppSizes.spacingXLarge),
          StatusHistoryList(entries: order.statusHistory),
          if (order.items.isNotEmpty) ...[
            const SizedBox(height: AppSizes.spacingXLarge),
            if (order.wasModified) ...[
              _ModifiedOrderBanner(modifiedAt: order.lastModifiedAt),
              const SizedBox(height: AppSizes.spacingMedium),
            ],
            OrderInvoiceSection(
              items: order.items,
              totalPrice: order.totalPrice,
              discountAmount: order.discountAmount,
              advertisementDiscountAmount: order.advertisementDiscountAmount,
              finalPrice: order.finalPrice,
            ),
          ],
          if (order.isReorderable) ...[
            const SizedBox(height: AppSizes.spacingMedium),
            // Section: "Reorder" - copies this order into a fresh, editable
            // cart. Creates nothing until the pharmacist checks out.
            ReorderButton(orderId: order.id),
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
          const SizedBox(height: AppSizes.spacingXLarge),
          _OrderComplaintsSection(
            order: order,
            onFileComplaint: () => _fileOrderComplaint(order),
            onOpenComplaint: (id) => context.pushNamed(
              RouteNames.complaintDetail,
              pathParameters: {'complaintId': id},
            ),
          ),
          if (order.isCancellable) ...[
            const SizedBox(height: AppSizes.spacingXLarge),
            _CancelOrderButton(
              isLoading: state.isCancelling,
              onPressed: _confirmCancel,
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
  }
}

// The design's equivalent highlight uses a static per-stage ETA that has no
// real backing data here - substituted with the most recent status_history
// timestamp instead, which is real.
class _CurrentStatusHighlight extends StatelessWidget {
  const _CurrentStatusHighlight({required this.order});

  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final stageIndex = order.stageIndex;
    if (stageIndex < 0) return const SizedBox.shrink();

    final description = orderStatusDescription(l10n, order.status);
    final lastUpdate = order.statusHistory.isEmpty ? null : order.statusHistory.last.changedAt;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSizes.spacingMedium),
      decoration: BoxDecoration(
        color: AppColors.primaryOf(context).withValues(alpha: 0.1),
        borderRadius: AppRadius.large,
      ),
      child: Row(
        children: [
          Icon(OrderProgressBar.stageIcons[stageIndex], size: 26, color: AppColors.primaryOf(context)),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  orderStatusLabel(l10n, order.status),
                  style: context.textTheme.titleSmall,
                ),
                if (description != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    description,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textOf(context),
                    ),
                  ),
                ],
                if (lastUpdate != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    l10n.lastUpdatedLabel(DateFormatter.formatDateTime(lastUpdate)),
                    style: context.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CancelOrderButton extends StatelessWidget {
  const _CancelOrderButton({required this.isLoading, required this.onPressed});

  final bool isLoading;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final color = AppColors.errorOf(context);

    return SizedBox(
      width: double.infinity,
      height: AppSizes.buttonHeight,
      child: OutlinedButton.icon(
        onPressed: isLoading ? null : onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: color,
          side: BorderSide(color: color, width: 1.5),
          shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
        ),
        icon: isLoading
            ? SizedBox(
                height: 18,
                width: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: color),
              )
            : const Icon(Icons.cancel_outlined),
        label: Text(l10n.cancelOrderButton),
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
      // See _deleteReturn above - same extra-pop bug.
      onAction: () => cubit.submitReview(rating: rating, comment: comment.isEmpty ? null : comment),
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
          Center(
            child: _StarRatingRow(rating: _rating, onRatingChanged: (r) => setState(() => _rating = r)),
          ),
          const SizedBox(height: AppSizes.spacingMedium),
          AppTextField(label: l10n.rateWarehouseCommentLabel, controller: _commentController, maxLines: 2),
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
        // 44x44 tap target (icon itself stays 32) - large enough to hit
        // reliably without inflating the visual size of the stars.
        return SizedBox(
          width: 44,
          height: 44,
          child: InkWell(
            onTap: () => onRatingChanged!(starValue),
            borderRadius: BorderRadius.circular(22),
            child: Center(child: icon),
          ),
        );
      }),
    );
  }
}

// Section: the warehouse edited this order's items (still 'pending' - see
// order_model.dart's wasModified) - a visible heads-up above the invoice so
// the pharmacist notices the items/price below aren't what they originally
// submitted, rather than silently trusting stale mental math. Exact colors
// per the design (light orange fill + orange border), not the app's
// semantic error/warning color - there's no warning token in AppColors yet.
class _ModifiedOrderBanner extends StatelessWidget {
  const _ModifiedOrderBanner({this.modifiedAt});

  final DateTime? modifiedAt;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    const orange = Color(0xFFF57C00);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSizes.spacingMedium),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF3E0),
        borderRadius: AppRadius.large,
        border: Border.all(color: orange),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.warning_amber_rounded, color: orange),
          const SizedBox(width: AppSizes.spacingSmall),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.orderModifiedBannerTitle,
                  style: context.textTheme.bodyMedium?.copyWith(color: orange, fontWeight: FontWeight.w600),
                ),
                if (modifiedAt != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    DateFormatter.formatDateTime(modifiedAt!),
                    style: context.textTheme.bodySmall?.copyWith(color: orange),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Complaint Section 9: the complaints filed about this order. Always shown -
// when there are none it is a friendly prompt + CTA rather than an empty
// shell; when there are some, each row opens the full complaint detail. The
// "file a complaint about this order" CTA is here in both states.
class _OrderComplaintsSection extends StatelessWidget {
  const _OrderComplaintsSection({
    required this.order,
    required this.onFileComplaint,
    required this.onOpenComplaint,
  });

  final OrderModel order;
  final VoidCallback onFileComplaint;
  final void Function(String complaintId) onOpenComplaint;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final complaints = order.complaints;

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.support_agent_outlined, size: 20, color: AppColors.navyOf(context)),
              const SizedBox(width: AppSizes.spacingSmall),
              Expanded(
                child: Text(l10n.orderComplaintsSectionTitle, style: context.textTheme.titleMedium),
              ),
            ],
          ),
          if (complaints.isEmpty) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            Text(
              l10n.orderComplaintsEmptyPrompt,
              style: context.textTheme.bodyMedium?.copyWith(
                color: AppColors.textSecondaryOf(context),
              ),
            ),
          ] else
            for (final complaint in complaints) ...[
              const SizedBox(height: AppSizes.spacingSmall),
              InkWell(
                onTap: () => onOpenComplaint(complaint.id),
                borderRadius: AppRadius.small,
                child: Container(
                  padding: const EdgeInsets.all(AppSizes.spacingSmall),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceOf(context),
                    borderRadius: AppRadius.small,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              l10n.complaintNumberLabel(complaint.complaintNumber.toString()),
                              style: context.textTheme.bodySmall?.copyWith(
                                color: AppColors.textSecondaryOf(context),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              complaint.subject,
                              style: context.textTheme.bodyMedium,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppSizes.spacingSmall),
                      StatusBadge(
                        label: complaintStatusLabel(l10n, complaint.status),
                        tone: complaintStatusTone(complaint.status),
                      ),
                      const SizedBox(width: AppSizes.spacingXSmall),
                      Icon(
                        Icons.chevron_right,
                        size: AppSizes.iconSizeSmall,
                        color: AppColors.textSecondaryOf(context),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          const SizedBox(height: AppSizes.spacingMedium),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: onFileComplaint,
              icon: const Icon(Icons.add_comment_outlined, size: 18),
              label: Text(l10n.submitComplaintAboutOrderCta),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.navyOf(context),
                side: BorderSide(color: AppColors.navyOf(context)),
                shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      ),
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
        borderRadius: AppRadius.large,
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
