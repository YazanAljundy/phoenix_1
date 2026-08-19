import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/features/debts/data/models/warehouse_debt_model.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_cubit.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_state.dart';
import 'package:phoenix/features/reviews/data/models/review_model.dart';
import 'package:phoenix/features/reviews/presentation/managers/pharmacy_reviews_cubit.dart';
import 'package:phoenix/features/reviews/presentation/managers/pharmacy_reviews_state.dart';
import 'package:phoenix/features/settings/presentation/managers/settings_cubit.dart';
import 'package:phoenix/features/settings/presentation/managers/settings_state.dart';
import 'package:phoenix/routes/route_names.dart';

// Section 6.10: name, pharmacy name, phone, language switch, logout - the
// last screen for the pharmacist. Theme switching rides along too (it was
// already working via SettingsCubit before this screen existed); it's just
// not the focus, so it's a secondary control rather than a primary one.
class ProfileView extends StatelessWidget {
  const ProfileView({super.key});

  Future<void> _confirmLogout(BuildContext context) async {
    final l10n = context.l10n;
    final authCubit = context.read<AuthCubit>();

    await AppDialog.show(
      context: context,
      title: l10n.logoutConfirmTitle,
      content: l10n.logoutConfirmMessage,
      actionLabel: l10n.logout,
      onAction: () async {
        await authCubit.logout();
        if (context.mounted) context.goNamed(RouteNames.registration);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.profileTitle),
      ),
      body: BlocBuilder<AuthCubit, AuthState>(
        builder: (context, authState) {
          final user = authState.user;
          final pharmacy = authState.pharmacy;
          final pharmacyName = pharmacy == null
              ? null
              : (isArabic ? pharmacy.nameAr : pharmacy.nameEn);

          return ListView(
            padding: AppPadding.screen,
            children: [
              CustomCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 28,
                          backgroundColor: AppColors.primaryOf(context).withValues(alpha: 0.1),
                          child: Icon(Icons.person, color: AppColors.primaryOf(context), size: 32),
                        ),
                        const SizedBox(width: AppSizes.spacingMedium),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                user?.name ?? '',
                                style: context.textTheme.titleLarge,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                user?.phone ?? '',
                                style: context.textTheme.bodyMedium?.copyWith(
                                  color: AppColors.textSecondaryOf(context),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (pharmacyName != null) ...[
                      const Divider(height: AppSizes.spacingLarge),
                      Row(
                        children: [
                          Icon(
                            Icons.local_pharmacy_outlined,
                            size: AppSizes.iconSizeSmall,
                            color: AppColors.textSecondaryOf(context),
                          ),
                          const SizedBox(width: AppSizes.spacingSmall),
                          Text(l10n.pharmacyNameLabel, style: context.textTheme.bodyMedium),
                          const Spacer(),
                          Flexible(
                            child: Text(
                              pharmacyName,
                              style: context.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textAlign: TextAlign.end,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),

              const SizedBox(height: AppSizes.spacingXLarge),
              Text(l10n.yourRatingTitle, style: context.textTheme.titleMedium),
              const SizedBox(height: AppSizes.spacingSmall),
              BlocBuilder<PharmacyReviewsCubit, PharmacyReviewsState>(
                builder: (context, reviewsState) {
                  if (reviewsState.status == PharmacyReviewsStatus.loading ||
                      reviewsState.status == PharmacyReviewsStatus.initial) {
                    return const SizedBox(
                      height: 24,
                      child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                    );
                  }
                  if (reviewsState.reviews.isEmpty) {
                    return Text(
                      l10n.noRatingsYet,
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                    );
                  }
                  return CustomCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            _StarRow(rating: reviewsState.averageRating.round()),
                            const SizedBox(width: AppSizes.spacingSmall),
                            Flexible(
                              child: Text(
                                l10n.ratingSummary(
                                  reviewsState.averageRating.toStringAsFixed(1),
                                  reviewsState.reviews.length.toString(),
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
                        for (final review in reviewsState.reviews.take(3)) ...[
                          const Divider(height: AppSizes.spacingLarge),
                          _ReviewTile(review: review, isArabic: isArabic),
                        ],
                      ],
                    ),
                  );
                },
              ),

              const SizedBox(height: AppSizes.spacingXLarge),
              Text(l10n.myDebtsTitle, style: context.textTheme.titleMedium),
              const SizedBox(height: AppSizes.spacingSmall),
              BlocBuilder<DebtsCubit, DebtsState>(
                builder: (context, debtsState) {
                  if (debtsState.status == DebtsStatus.loading ||
                      debtsState.status == DebtsStatus.initial) {
                    return const SizedBox(
                      height: 24,
                      child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                    );
                  }
                  if (debtsState.debts.isEmpty) {
                    return Text(
                      l10n.noDebtsYet,
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: AppColors.textSecondaryOf(context),
                      ),
                    );
                  }
                  return CustomCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final debt in debtsState.debts) ...[
                          if (debt != debtsState.debts.first)
                            const Divider(height: AppSizes.spacingLarge),
                          _DebtTile(debt: debt, isArabic: isArabic),
                        ],
                      ],
                    ),
                  );
                },
              ),

              const SizedBox(height: AppSizes.spacingXLarge),
              Text(l10n.language, style: context.textTheme.titleMedium),
              const SizedBox(height: AppSizes.spacingSmall),
              BlocBuilder<SettingsCubit, SettingsState>(
                builder: (context, settingsState) {
                  final currentCode = settingsState.locale?.languageCode ?? 'ar';
                  return Wrap(
                    spacing: AppSizes.spacingSmall,
                    children: [
                      ChoiceChip(
                        label: const Text('العربية'),
                        selected: currentCode == 'ar',
                        shape: RoundedRectangleBorder(borderRadius: AppRadius.full),
                        onSelected: (_) =>
                            context.read<SettingsCubit>().changeLocale(const Locale('ar')),
                      ),
                      ChoiceChip(
                        label: const Text('English'),
                        selected: currentCode == 'en',
                        shape: RoundedRectangleBorder(borderRadius: AppRadius.full),
                        onSelected: (_) =>
                            context.read<SettingsCubit>().changeLocale(const Locale('en')),
                      ),
                    ],
                  );
                },
              ),

              const SizedBox(height: AppSizes.spacingXLarge),
              Text(l10n.theme, style: context.textTheme.titleMedium),
              const SizedBox(height: AppSizes.spacingSmall),
              BlocBuilder<SettingsCubit, SettingsState>(
                builder: (context, settingsState) {
                  return Wrap(
                    spacing: AppSizes.spacingSmall,
                    children: [
                      ChoiceChip(
                        label: Text(l10n.light),
                        selected: settingsState.themeMode == ThemeMode.light,
                        shape: RoundedRectangleBorder(borderRadius: AppRadius.full),
                        onSelected: (_) =>
                            context.read<SettingsCubit>().changeTheme(ThemeMode.light),
                      ),
                      ChoiceChip(
                        label: Text(l10n.dark),
                        selected: settingsState.themeMode == ThemeMode.dark,
                        shape: RoundedRectangleBorder(borderRadius: AppRadius.full),
                        onSelected: (_) =>
                            context.read<SettingsCubit>().changeTheme(ThemeMode.dark),
                      ),
                      ChoiceChip(
                        label: Text(l10n.system),
                        selected: settingsState.themeMode == ThemeMode.system,
                        shape: RoundedRectangleBorder(borderRadius: AppRadius.full),
                        onSelected: (_) =>
                            context.read<SettingsCubit>().changeTheme(ThemeMode.system),
                      ),
                    ],
                  );
                },
              ),

              const SizedBox(height: AppSizes.spacingXLarge),
              SizedBox(
                width: double.infinity,
                height: AppSizes.buttonHeight,
                child: OutlinedButton(
                  onPressed: () => _confirmLogout(context),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.errorOf(context),
                    side: BorderSide(color: AppColors.errorOf(context)),
                    shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                    padding: AppPadding.button,
                  ),
                  child: Text(l10n.logout),
                ),
              ),
            ],
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

class _ReviewTile extends StatelessWidget {
  const _ReviewTile({required this.review, required this.isArabic});

  final ReviewModel review;
  final bool isArabic;

  @override
  Widget build(BuildContext context) {
    final warehouseName = isArabic ? review.warehouseNameAr : review.warehouseNameEn;

    return Column(
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
          const SizedBox(height: 2),
          Text(
            warehouseName,
            style: context.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
        if (review.comment != null && review.comment!.isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(review.comment!, style: context.textTheme.bodyMedium),
        ],
      ],
    );
  }
}

// Section 16: one row of "my debts" - tapping it opens the read-only detail
// screen (orders + payments) for that one warehouse, see DebtDetailView.
class _DebtTile extends StatelessWidget {
  const _DebtTile({required this.debt, required this.isArabic});

  final WarehouseDebtModel debt;
  final bool isArabic;

  @override
  Widget build(BuildContext context) {
    final name = isArabic ? debt.nameAr : (debt.nameEn ?? debt.nameAr);

    return InkWell(
      onTap: () => context.pushNamed(
        RouteNames.debtDetail,
        pathParameters: {'warehouseId': debt.warehouseId},
        extra: name,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              name,
              style: context.textTheme.bodyMedium,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppSizes.spacingSmall),
          Text(
            '\$${debt.balanceUsd}',
            style: context.textTheme.bodyMedium?.copyWith(
              color: AppColors.errorOf(context),
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(width: AppSizes.spacingXSmall),
          Icon(Icons.chevron_right, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
        ],
      ),
    );
  }
}
