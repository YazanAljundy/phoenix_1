import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/theme/app_text_theme.dart';
import 'package:feniq/core/utils/currency_formatter.dart';
import 'package:feniq/core/widgets/app_network_image.dart';
import 'package:feniq/features/advertisements/data/models/advertisement_model.dart';
import 'package:feniq/features/advertisements/presentation/utils/advertisement_cart_launcher.dart';
import 'package:feniq/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';

// One advertised package: its products, each at its advertised price, and the
// package total the pharmacy actually pays. Tapping it fetches the package
// fresh from the server, drops it into the EXISTING cart and opens the cart
// screen - no separate advertisement cart, no intermediate screen.
//
// Double-tap safe: `_busy` gates the whole flow.
class AdvertisementCard extends StatefulWidget {
  const AdvertisementCard({super.key, required this.advertisement});

  final AdvertisementModel advertisement;

  @override
  State<AdvertisementCard> createState() => _AdvertisementCardState();
}

class _AdvertisementCardState extends State<AdvertisementCard> {
  bool _busy = false;

  Future<void> _onTap() async {
    if (_busy) return;
    setState(() => _busy = true);
    // The shared package -> cart flow (re-fetch, incomplete/conflict handling,
    // then the existing cart screen), used by every entry point that can open
    // a package - see advertisement_cart_launcher.dart.
    await launchAdvertisementCart(context, widget.advertisement.id);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final advertisement = widget.advertisement;
    final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;

    String money(num usd) => formatMoneyFromUsd(usd, usdToSyp, l10n.currencySuffix);
    final title = isArabic
        ? advertisement.titleAr
        : (advertisement.titleEn ?? advertisement.titleAr);
    final warehouseName = isArabic
        ? advertisement.warehouseNameAr
        : (advertisement.warehouseNameEn ?? advertisement.warehouseNameAr);

    return Card(
      margin: const EdgeInsets.only(bottom: AppSizes.spacingMedium),
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.large),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: _busy ? null : _onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSizes.spacingMedium),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Optional - most packages carry no image of their own, in
              // which case this renders nothing and the card looks exactly
              // as it always has.
              if (advertisement.imageUrl != null && advertisement.imageUrl!.trim().isNotEmpty) ...[
                ClipRRect(
                  borderRadius: AppRadius.medium,
                  child: AppNetworkImage(
                    url: advertisement.imageUrl,
                    height: 120,
                    width: double.infinity,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(height: AppSizes.spacingSmall),
              ],
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: context.textTheme.titleMedium,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          warehouseName,
                          style: context.textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondaryOf(context),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  if (advertisement.hasSaving)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.primaryOf(context),
                        borderRadius: AppRadius.full,
                      ),
                      child: Text(
                        l10n.advertisementSavingPercent(advertisement.savingPercentage),
                        style: context.textTheme.labelSmall?.copyWith(color: Colors.white),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: AppSizes.spacingSmall),

              // Each product line: name, its package quantity, and the line's
              // catalog cost (price x quantity). A product that has since been
              // removed (priceUsd null) shows no price - the tap handler blocks
              // ordering an incomplete package anyway.
              for (final item in advertisement.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          isArabic ? item.nameAr : (item.nameEn ?? item.nameAr),
                          style: context.textTheme.bodyMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsetsDirectional.only(end: AppSizes.spacingSmall),
                        child: Text(
                          l10n.advertisementItemQuantity(item.quantity),
                          style: context.textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondaryOf(context),
                          ),
                        ),
                      ),
                      if (item.lineTotalUsd != null)
                        Text(
                          money(item.lineTotalUsd!),
                          style: context.textTheme.bodyMedium?.copyWith(fontWeight: AppTextTheme.semiBold),
                        ),
                    ],
                  ),
                ),

              const Divider(height: AppSizes.spacingMedium),

              // The two pricing levels, kept visually apart: the sum of the
              // lines struck through, the package price as the headline.
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(l10n.advertisementPackageTotal, style: context.textTheme.titleSmall),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: AppSizes.spacingXSmall,
                    children: [
                      if (advertisement.hasSaving)
                        Text(
                          money(advertisement.itemsTotalUsd),
                          style: context.textTheme.bodySmall?.copyWith(
                            decoration: TextDecoration.lineThrough,
                            color: AppColors.textSecondaryOf(context),
                          ),
                        ),
                      Text(
                        money(advertisement.totalPriceUsd),
                        style: context.textTheme.titleMedium?.copyWith(
                          color: AppColors.primaryOf(context),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: AppSizes.spacingSmall),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _busy ? null : _onTap,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primaryOf(context),
                    foregroundColor: Colors.white,
                    shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                  ),
                  child: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text(l10n.advertisementAddToCartButton),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
