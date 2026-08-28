import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/app_network_image.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/core/widgets/whatsapp_button.dart';
import 'package:phoenix/features/cart/presentation/widgets/cart_button.dart';
import 'package:phoenix/features/catalog/data/models/manufacturers_route_args.dart';
import 'package:phoenix/features/warehouse_selection/data/models/warehouse_profile_model.dart';
import 'package:phoenix/features/warehouse_selection/presentation/managers/warehouse_profile_cubit.dart';
import 'package:phoenix/features/warehouse_selection/presentation/managers/warehouse_profile_state.dart';
import 'package:phoenix/routes/route_names.dart';

// Section 17: the pharmacist's read-only "about this warehouse" screen -
// reached from a separate affordance on WarehouseCard (an info icon, not
// the "Select" button, which still goes straight to /manufacturers). Every
// field here is display-only; nothing on this screen touches the cart or
// order flow, see the "browse products" button at the bottom which is the
// only way forward from here.
class WarehouseProfileView extends StatelessWidget {
  const WarehouseProfileView({super.key, required this.warehouseId, required this.warehouseName});

  final String warehouseId;
  final String warehouseName;

  void _browseProducts(BuildContext context, WarehouseProfileModel profile) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? profile.nameAr : profile.nameEn;
    context.pushNamed(
      RouteNames.manufacturers,
      pathParameters: {'warehouseId': warehouseId},
      extra: ManufacturersRouteArgs(warehouseName: name),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(warehouseName, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: const [CartButton()],
      ),
      body: BlocBuilder<WarehouseProfileCubit, WarehouseProfileState>(
        builder: (context, state) {
          if (state.status == WarehouseProfileStatus.initial ||
              state.status == WarehouseProfileStatus.loading) {
            return const AppLoading();
          }
          if (state.status == WarehouseProfileStatus.error || state.profile == null) {
            return FailureWidget(
              message: translateErrorCode(l10n, state.errorCode, state.errorMessage ?? l10n.errorState),
              onRetry: () => context.read<WarehouseProfileCubit>().load(),
            );
          }

          final profile = state.profile!;
          // Section 17: single column on mobile, centered with a max width
          // on wider/tablet screens (LayoutBuilder rather than a fixed
          // width, so it still fills a narrow phone screen exactly as
          // before).
          return LayoutBuilder(
            builder: (context, constraints) {
              return SingleChildScrollView(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 640),
                    child: Padding(
                      padding: AppPadding.screen,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _ProfileHeader(profile: profile),
                          const SizedBox(height: AppSizes.spacingXLarge),
                          _ContactSection(profile: profile),
                          const SizedBox(height: AppSizes.spacingMedium),
                          _DeliverySection(profile: profile),
                          const SizedBox(height: AppSizes.spacingMedium),
                          _ReviewsSection(profile: profile),
                          const SizedBox(height: AppSizes.spacingXLarge),
                          PrimaryButton(
                            label: l10n.browseWarehouseProductsButton,
                            onPressed: () => _browseProducts(context, profile),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.profile});

  final WarehouseProfileModel profile;

  @override
  Widget build(BuildContext context) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic ? profile.nameAr : profile.nameEn;

    return Column(
      children: [
        ClipRRect(
          borderRadius: AppRadius.large,
          child: AspectRatio(
            aspectRatio: 2.2,
            child: AppNetworkImage(
              url: profile.logo,
              fit: BoxFit.cover,
              fallback: Container(
                color: AppColors.surfaceOf(context),
                alignment: Alignment.center,
                child: Icon(
                  Icons.local_shipping_outlined,
                  color: AppColors.navyOf(context),
                  size: AppSizes.iconSizeLarge,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSizes.spacingMedium),
        Text(
          name,
          style: context.textTheme.displaySmall,
          textAlign: TextAlign.center,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: AppSizes.spacingXSmall),
        Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.location_on_outlined, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
            const SizedBox(width: AppSizes.spacingXSmall),
            Flexible(
              child: Text(
                profile.city,
                style: context.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondaryOf(context)),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _ContactSection extends StatelessWidget {
  const _ContactSection({required this.profile});

  final WarehouseProfileModel profile;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.phone_outlined, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
              const SizedBox(width: AppSizes.spacingSmall),
              Expanded(
                child: Text(
                  profile.phone,
                  style: context.textTheme.bodyMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              WhatsAppButton(phone: profile.phone),
            ],
          ),
          const SizedBox(height: AppSizes.spacingSmall),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.map_outlined,
                size: AppSizes.iconSizeSmall,
                color: AppColors.textSecondaryOf(context),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              Expanded(
                child: Text(
                  '${l10n.addressLabel}: ${profile.address}',
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondaryOf(context),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DeliverySection extends StatelessWidget {
  const _DeliverySection({required this.profile});

  final WarehouseProfileModel profile;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final hasHours = profile.deliveryStartTime != null && profile.deliveryEndTime != null;
    final deliveryTypeLabel = profile.deliveryType == 'third_party'
        ? l10n.deliveryTypeThirdPartyLabel
        : l10n.deliveryTypeSelfLabel;

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.deliveryInfoTitle, style: context.textTheme.titleMedium),
          const SizedBox(height: AppSizes.spacingSmall),
          _IconTextRow(
            icon: Icons.schedule_outlined,
            text: hasHours
                ? l10n.deliveryHoursValue(profile.deliveryStartTime!, profile.deliveryEndTime!)
                : l10n.deliveryHoursNotSet,
          ),
          const SizedBox(height: AppSizes.spacingXSmall),
          _IconTextRow(icon: Icons.local_shipping_outlined, text: deliveryTypeLabel),
          const SizedBox(height: AppSizes.spacingSmall),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
              const SizedBox(width: AppSizes.spacingXSmall),
              Expanded(
                child: Text(
                  l10n.deliveryInfoDisclaimer,
                  style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _IconTextRow extends StatelessWidget {
  const _IconTextRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
        const SizedBox(width: AppSizes.spacingSmall),
        Expanded(
          child: Text(
            text,
            style: context.textTheme.bodyMedium,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _ReviewsSection extends StatelessWidget {
  const _ReviewsSection({required this.profile});

  final WarehouseProfileModel profile;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.warehouseReviewsTitle, style: context.textTheme.titleMedium),
        const SizedBox(height: AppSizes.spacingSmall),
        if (profile.reviewsCount == 0)
          Text(
            l10n.noWarehouseReviewsYet,
            style: context.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondaryOf(context)),
          )
        else ...[
          CustomCard(
            child: Row(
              children: [
                _StarRow(rating: profile.averageRating.round()),
                const SizedBox(width: AppSizes.spacingSmall),
                Flexible(
                  child: Text(
                    l10n.ratingSummary(
                      profile.averageRating.toStringAsFixed(1),
                      profile.reviewsCount.toString(),
                    ),
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          // Each review is its own bordered card, not one card with dividers
          // between rows - a short, scannable list of independent opinions
          // reads more clearly this way than one continuous block.
          for (final review in profile.recentReviews) ...[
            const SizedBox(height: AppSizes.spacingSmall),
            _ReviewCard(review: review),
          ],
        ],
      ],
    );
  }
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review});

  final WarehouseReviewModel review;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final reviewerName = review.reviewerName != null && review.reviewerName!.trim().isNotEmpty
        ? review.reviewerName!
        : l10n.anonymousReviewerName;

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.person_outline,
                      size: AppSizes.iconSizeSmall,
                      color: AppColors.textSecondaryOf(context),
                    ),
                    const SizedBox(width: AppSizes.spacingXSmall),
                    Flexible(
                      child: Text(
                        reviewerName,
                        style: context.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSizes.spacingSmall),
              _StarRow(rating: review.rating, size: 14),
            ],
          ),
          if (review.comment != null && review.comment!.isNotEmpty) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Text(review.comment!, style: context.textTheme.bodyMedium),
          ],
          const SizedBox(height: AppSizes.spacingXSmall),
          Text(
            DateFormatter.formatDate(review.createdAt),
            style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondaryOf(context)),
          ),
        ],
      ),
    );
  }
}

class _StarRow extends StatelessWidget {
  const _StarRow({required this.rating, this.size = 18});

  final int rating;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        final filled = index < rating;
        return Icon(
          filled ? Icons.star : Icons.star_border,
          size: size,
          color: filled ? AppColors.primaryOf(context) : AppColors.borderOf(context),
        );
      }),
    );
  }
}
