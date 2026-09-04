import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_loading.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/empty_view.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/features/reviews/data/models/review_model.dart';
import 'package:phoenix/features/reviews/presentation/managers/pharmacy_reviews_cubit.dart';
import 'package:phoenix/features/reviews/presentation/managers/pharmacy_reviews_state.dart';

// The pharmacist's own ratings/reviews list, opened from the Profile screen's
// compact Ratings entry. It is only a full-screen home for what ProfileView
// used to show inline (the summary card + the review cards, previously capped
// at 3) - the same PharmacyReviewsCubit, repository, API and models, nothing
// about how a rating is produced or calculated changes here.
class PharmacyReviewsView extends StatelessWidget {
  const PharmacyReviewsView({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.yourRatingTitle),
      ),
      body: BlocBuilder<PharmacyReviewsCubit, PharmacyReviewsState>(
        builder: (context, state) {
          if (state.status == PharmacyReviewsStatus.loading ||
              state.status == PharmacyReviewsStatus.initial) {
            return const AppLoading();
          }
          if (state.status == PharmacyReviewsStatus.error && state.reviews.isEmpty) {
            return FailureWidget(
              message: translateErrorCode(
                l10n,
                state.errorCode,
                state.errorMessage ?? l10n.errorState,
              ),
              onRetry: () => context.read<PharmacyReviewsCubit>().load(),
            );
          }
          if (state.reviews.isEmpty) {
            return RefreshIndicator(
              onRefresh: () => context.read<PharmacyReviewsCubit>().load(),
              child: LayoutBuilder(
                builder: (context, constraints) => SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(minHeight: constraints.maxHeight),
                    child: EmptyView(message: l10n.noRatingsYet, icon: Icons.star_border_rounded),
                  ),
                ),
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<PharmacyReviewsCubit>().load(),
            child: ListView(
              padding: AppPadding.screen,
              children: [
                CustomCard(
                  child: Row(
                    children: [
                      _StarRow(rating: state.averageRating.round()),
                      const SizedBox(width: AppSizes.spacingSmall),
                      Flexible(
                        child: Text(
                          l10n.ratingSummary(
                            state.averageRating.toStringAsFixed(1),
                            state.reviews.length.toString(),
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
                for (final review in state.reviews) ...[
                  const SizedBox(height: AppSizes.spacingSmall),
                  _ReviewCard(review: review, isArabic: isArabic),
                ],
              ],
            ),
          );
        },
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

// Restyled to match the individually-bordered review-card pattern established
// on the Warehouse Profile screen - moved here verbatim from ProfileView.
class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review, required this.isArabic});

  final ReviewModel review;
  final bool isArabic;

  @override
  Widget build(BuildContext context) {
    final warehouseName = isArabic ? review.warehouseNameAr : review.warehouseNameEn;

    return CustomCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _StarRow(rating: review.rating, size: 14),
              Text(
                DateFormatter.formatDate(review.createdAt),
                style: context.textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
            ],
          ),
          if (warehouseName != null) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Text(
              warehouseName,
              style: context.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (review.comment != null && review.comment!.isNotEmpty) ...[
            const SizedBox(height: AppSizes.spacingXSmall),
            Text(review.comment!, style: context.textTheme.bodyMedium),
          ],
        ],
      ),
    );
  }
}
