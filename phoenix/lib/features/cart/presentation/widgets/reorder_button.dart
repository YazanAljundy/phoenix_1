import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/error/failure.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/features/cart/data/models/reorder_preparation.dart';
import 'package:phoenix/features/cart/data/repositories/order_repository.dart';
import 'package:phoenix/features/cart/presentation/managers/cart_cubit.dart';
import 'package:phoenix/routes/route_names.dart';

// "Reorder" - drops a past delivered order into the existing cart, bound to
// that order's own warehouse, then opens the Cart screen for the pharmacist to
// review/edit before checking out. Creates no order (that happens on the
// normal checkout). Self-contained so both the order-history list and the
// order-tracking screen can drop it in unchanged.
//
// Double-tap safe: `_busy` gates the whole flow and the button disables while
// the request / dialogs are in flight.
class ReorderButton extends StatefulWidget {
  const ReorderButton({super.key, required this.orderId, this.dense = false});

  final String orderId;
  // A tighter button for the list-tile row; the tracking screen uses the
  // full-width default.
  final bool dense;

  @override
  State<ReorderButton> createState() => _ReorderButtonState();
}

class _ReorderButtonState extends State<ReorderButton> {
  bool _busy = false;

  Future<bool> _confirm({
    required String title,
    required String content,
    required String actionLabel,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(content),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext, rootNavigator: true).pop(false),
            child: Text(dialogContext.l10n.cancel),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext, rootNavigator: true).pop(true),
            child: Text(actionLabel),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _onPressed() async {
    if (_busy) return;
    setState(() => _busy = true);

    final l10n = context.l10n;
    final orderRepository = context.read<OrderRepository>();
    final cartCubit = context.read<CartCubit>();

    ReorderPreparation preparation;
    try {
      preparation = await orderRepository.prepareReorder(widget.orderId);
    } on Failure catch (f) {
      if (mounted) {
        await AppDialog.show(
          context: context,
          title: l10n.errorState,
          content: translateErrorCode(l10n, f.code, f.errMessage),
        );
      }
      if (mounted) setState(() => _busy = false);
      return;
    } catch (_) {
      if (mounted) {
        await AppDialog.show(context: context, title: l10n.errorState, content: l10n.errorState);
      }
      if (mounted) setState(() => _busy = false);
      return;
    }

    if (!mounted) return;

    if (!preparation.hasItems) {
      // Every product from the old order is gone from this warehouse.
      await AppDialog.show(
        context: context,
        title: l10n.reorderUnavailableTitle,
        content: l10n.reorderNoItemsMessage,
      );
      if (mounted) setState(() => _busy = false);
      return;
    }

    // Section 7: any cart that already has items is replaced (never silently
    // merged). A cross-warehouse cart reuses the project's existing conflict
    // copy; a same-warehouse cart gets the plainer "replace" prompt.
    if (cartCubit.state.items.isNotEmpty) {
      final crossWarehouse = cartCubit.state.warehouseId != preparation.warehouseId;
      final confirmed = await _confirm(
        title: crossWarehouse ? l10n.cartConflictTitle : l10n.reorderReplaceCartTitle,
        content: crossWarehouse
            ? l10n.cartConflictMessage(cartCubit.state.warehouseName ?? '')
            : l10n.reorderReplaceCartMessage,
        actionLabel: crossWarehouse ? l10n.cartConflictConfirmButton : l10n.reorderReplaceCartConfirm,
      );
      if (!confirmed) {
        if (mounted) setState(() => _busy = false);
        return;
      }
    }

    if (!mounted) return;
    await _applyAndOpenCart(preparation);
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _applyAndOpenCart(ReorderPreparation preparation) async {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    if (preparation.unavailableItems.isNotEmpty) {
      final names = preparation.unavailableItems
          .map((item) => isArabic ? item.productNameAr : (item.productNameEn ?? item.productNameAr))
          .join(isArabic ? '، ' : ', ');
      await AppDialog.show(
        context: context,
        title: l10n.reorderUnavailableTitle,
        content: l10n.reorderSomeItemsUnavailable(names),
      );
      if (!mounted) return;
    }

    context.read<CartCubit>().loadReorder(
      warehouseId: preparation.warehouseId,
      warehouseName: isArabic
          ? preparation.warehouseNameAr
          : (preparation.warehouseNameEn ?? preparation.warehouseNameAr),
      items: preparation.items,
    );
    context.pushNamed(RouteNames.cart);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final icon = _busy
        ? const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : const Icon(Icons.replay, size: 18);

    return OutlinedButton.icon(
      onPressed: _busy ? null : _onPressed,
      icon: icon,
      label: Text(l10n.reorderButton),
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.navyOf(context),
        side: BorderSide(color: AppColors.navyOf(context)),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.small),
        padding: EdgeInsets.symmetric(
          horizontal: widget.dense ? 12 : 16,
          vertical: widget.dense ? 6 : 12,
        ),
        minimumSize: widget.dense ? const Size(0, 0) : null,
        tapTargetSize: widget.dense ? MaterialTapTargetSize.shrinkWrap : null,
      ),
    );
  }
}
