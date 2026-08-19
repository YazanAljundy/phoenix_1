import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/secondary_price_hint.dart';
import 'package:phoenix/features/cart/data/models/cart_item.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

class CartItemTile extends StatefulWidget {
  const CartItemTile({
    super.key,
    required this.item,
    required this.onQuantityChanged,
    required this.onRemove,
  });

  final CartItem item;
  final ValueChanged<int> onQuantityChanged;
  final VoidCallback onRemove;

  @override
  State<CartItemTile> createState() => _CartItemTileState();
}

class _CartItemTileState extends State<CartItemTile> {
  late final TextEditingController _controller = TextEditingController(
    text: '${widget.item.quantity}',
  );
  late final FocusNode _focusNode = FocusNode()..addListener(_handleFocusChange);

  @override
  void didUpdateWidget(covariant CartItemTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Keeps the field in sync with quantity changes from elsewhere (e.g. the
    // same product re-added from the catalog) without clobbering whatever
    // the pharmacist is actively typing right now.
    if (oldWidget.item.quantity != widget.item.quantity && !_focusNode.hasFocus) {
      _controller.text = '${widget.item.quantity}';
    }
  }

  @override
  void dispose() {
    _focusNode.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _handleFocusChange() {
    if (!_focusNode.hasFocus) _commit();
  }

  Future<void> _commit() async {
    final text = _controller.text.trim();

    if (text.isEmpty) {
      await _confirmRemoval();
      return;
    }

    final parsed = int.tryParse(text);
    if (parsed == null || parsed < 0) {
      // Not a number, or negative - ignored, back to the last real value.
      _controller.text = '${widget.item.quantity}';
      return;
    }

    if (parsed == 0) {
      await _confirmRemoval();
      return;
    }

    if (parsed != widget.item.quantity) {
      widget.onQuantityChanged(parsed);
    }
  }

  Future<void> _confirmRemoval() async {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? widget.item.nameAr : (widget.item.nameEn ?? widget.item.nameAr);

    await AppDialog.show(
      context: context,
      title: l10n.removeItemTitle,
      content: l10n.removeItemConfirmation(name),
      actionLabel: l10n.removeButton,
      onAction: widget.onRemove,
    );
    if (!mounted) return;
    // Cancelled - show the real quantity again. (If confirmed instead, this
    // tile is about to be removed from the list anyway.)
    _controller.text = '${widget.item.quantity}';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final item = widget.item;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? item.nameAr : (item.nameEn ?? item.nameAr);
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
    final sypText = formatSypApprox(item.discountPriceUsd, usdToSyp, l10n.currencySuffix);

    return CustomCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _ItemImage(url: item.image),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: context.textTheme.titleMedium,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSizes.spacingXSmall),
                if (item.hasOffer)
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: AppSizes.spacingSmall,
                    children: [
                      Text(
                        '\$${item.unitPriceUsd}',
                        style: TextStyle(
                          decoration: TextDecoration.lineThrough,
                          color: AppColors.textSecondaryOf(context),
                          fontSize: 12,
                        ),
                      ),
                      Text(
                        '\$${item.discountPriceUsd}',
                        style: TextStyle(
                          color: AppColors.secondaryOf(context),
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (sypText != null) SecondaryPriceHint(text: sypText),
                    ],
                  )
                else
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: AppSizes.spacingXSmall,
                    children: [
                      Text(
                        '\$${item.discountPriceUsd}',
                        style: TextStyle(
                          color: AppColors.primaryOf(context),
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (sypText != null) SecondaryPriceHint(text: sypText),
                    ],
                  ),
                const SizedBox(height: AppSizes.spacingSmall),
                Row(
                  children: [
                    SizedBox(
                      width: 64,
                      child: TextField(
                        controller: _controller,
                        focusNode: _focusNode,
                        keyboardType: TextInputType.number,
                        textInputAction: TextInputAction.done,
                        textAlign: TextAlign.center,
                        style: context.textTheme.titleMedium,
                        onEditingComplete: () => _focusNode.unfocus(),
                        decoration: InputDecoration(
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(vertical: 8),
                          filled: true,
                          fillColor: AppColors.surfaceOf(context),
                          border: OutlineInputBorder(
                            borderRadius: AppRadius.small,
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: Icon(Icons.delete_outline, color: AppColors.errorOf(context)),
                      onPressed: _confirmRemoval,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemImage extends StatelessWidget {
  const _ItemImage({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    // TODO(seed-images): same placeholder note as ProductCard - see
    // features/catalog/presentation/widgets/product_card.dart.
    return ClipRRect(
      borderRadius: AppRadius.small,
      child: Container(
        width: 56,
        height: 56,
        color: AppColors.surfaceOf(context),
        child: url == null || url!.isEmpty
            ? Icon(Icons.medication_outlined, color: AppColors.textSecondaryOf(context))
            : Image.network(
                url!,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => Icon(
                  Icons.medication_outlined,
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
      ),
    );
  }
}
