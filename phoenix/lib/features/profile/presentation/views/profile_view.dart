import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/currency_formatter.dart';
import 'package:phoenix/core/utils/date_formatter.dart';
import 'package:phoenix/core/widgets/app_dialog.dart';
import 'package:phoenix/core/widgets/custom_card.dart';
import 'package:phoenix/core/widgets/failure_widget.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/features/debts/data/models/warehouse_debt_model.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_cubit.dart';
import 'package:phoenix/features/debts/presentation/managers/debts_state.dart';
import 'package:phoenix/features/exchange_rate/presentation/managers/exchange_rate_cubit.dart';
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
//
// Visual-polish pass: the screen is now laid out as labelled sections
// (identity header -> personal information -> rating -> debts -> settings ->
// account actions) so it reads like a formal account screen rather than a
// stack of loose widgets. Every cubit, handler, route and piece of state is
// exactly as it was - this pass only touches layout, spacing and styling.
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
          final city = pharmacy?.city;

          // The same values the header used to show, now also presented as a
          // labelled record. Nothing new is fetched - these all come straight
          // from the already-loaded auth state.
          final infoRows = <({String label, String value})>[
            if ((user?.name ?? '').isNotEmpty)
              (label: l10n.fullNameLabel, value: user!.name),
            if (pharmacyName != null && pharmacyName.isNotEmpty)
              (label: l10n.pharmacyNameLabel, value: pharmacyName),
            if (city != null && city.isNotEmpty)
              (label: l10n.cityLabel, value: city),
            if ((user?.phone ?? '').isNotEmpty)
              (label: l10n.phoneLabel, value: user!.phone),
          ];

          // Single column on phones, centred with a comfortable max width on
          // tablet / desktop / web so lines never stretch too wide.
          return Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: ListView(
                padding: AppPadding.screen,
                children: [
                  _IdentityHeader(
                    name: user?.name ?? '',
                    pharmacyName: pharmacyName,
                    city: city,
                  ),

                  if (infoRows.isNotEmpty) ...[
                    const SizedBox(height: AppSizes.spacingXLarge),
                    _SectionHeader(l10n.personalInfoTitle),
                    const SizedBox(height: AppSizes.spacingSmall),
                    _PersonalInfoCard(rows: infoRows),
                  ],

                  const SizedBox(height: AppSizes.spacingXLarge),
                  _SectionHeader(l10n.yourRatingTitle),
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
                      // A failed load must not masquerade as "no ratings yet".
                      if (reviewsState.status == PharmacyReviewsStatus.error &&
                          reviewsState.reviews.isEmpty) {
                        return FailureWidget(
                          dense: true,
                          message: translateErrorCode(
                            l10n,
                            reviewsState.errorCode,
                            reviewsState.errorMessage ?? l10n.errorState,
                          ),
                          onRetry: () => context.read<PharmacyReviewsCubit>().load(),
                        );
                      }
                      if (reviewsState.reviews.isEmpty) {
                        return _EmptyHint(l10n.noRatingsYet);
                      }
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          CustomCard(
                            child: Row(
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
                          ),
                          for (final review in reviewsState.reviews.take(3)) ...[
                            const SizedBox(height: AppSizes.spacingSmall),
                            _ReviewCard(review: review, isArabic: isArabic),
                          ],
                        ],
                      );
                    },
                  ),

                  const SizedBox(height: AppSizes.spacingXLarge),
                  _SectionHeader(l10n.myDebtsTitle),
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
                      // A failed load must not masquerade as "no debts yet".
                      if (debtsState.status == DebtsStatus.error && debtsState.debts.isEmpty) {
                        return FailureWidget(
                          dense: true,
                          message: translateErrorCode(
                            l10n,
                            debtsState.errorCode,
                            debtsState.errorMessage ?? l10n.errorState,
                          ),
                          onRetry: () => context.read<DebtsCubit>().load(),
                        );
                      }
                      if (debtsState.debts.isEmpty) {
                        return _EmptyHint(l10n.noDebtsYet);
                      }
                      final usdToSyp = context.watch<ExchangeRateCubit>().state.usdToSyp;
                      final total = debtsState.debts.fold<num>(0, (sum, d) => sum + d.balanceUsd);
                      final totalSypText = formatSypApprox(total, usdToSyp, l10n.currencySuffix);

                      return CustomCard(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSizes.spacingMedium,
                          vertical: AppSizes.spacingSmall,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            for (final debt in debtsState.debts)
                              _DebtTile(debt: debt, isArabic: isArabic, usdToSyp: usdToSyp),
                            Divider(height: AppSizes.spacingLarge, color: AppColors.borderOf(context)),
                            Padding(
                              padding: const EdgeInsets.only(bottom: AppSizes.spacingSmall),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(l10n.totalDebtsLabel, style: context.textTheme.titleSmall),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        '\$$total',
                                        style: context.textTheme.titleMedium?.copyWith(
                                          color: AppColors.errorOf(context),
                                        ),
                                      ),
                                      if (totalSypText != null)
                                        Text(
                                          totalSypText,
                                          style: context.textTheme.bodySmall?.copyWith(
                                            color: AppColors.textSecondaryOf(context),
                                          ),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),

                  const SizedBox(height: AppSizes.spacingXLarge),
                  _SectionHeader(l10n.complaintsTitle),
                  const SizedBox(height: AppSizes.spacingSmall),
                  CustomCard(
                    onTap: () => context.pushNamed(RouteNames.complaints),
                    child: Row(
                      children: [
                        Icon(Icons.support_agent_outlined, size: 22, color: AppColors.navyOf(context)),
                        const SizedBox(width: AppSizes.spacingMedium),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(l10n.complaintsTitle, style: context.textTheme.titleSmall),
                              const SizedBox(height: 2),
                              Text(
                                l10n.complaintsProfileSubtitle,
                                style: context.textTheme.bodySmall?.copyWith(
                                  color: AppColors.textSecondaryOf(context),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          Icons.chevron_right,
                          size: AppSizes.iconSizeSmall,
                          color: AppColors.textSecondaryOf(context),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: AppSizes.spacingXLarge),
                  _SectionHeader(l10n.settings),
                  const SizedBox(height: AppSizes.spacingSmall),
                  BlocBuilder<SettingsCubit, SettingsState>(
                    builder: (context, settingsState) {
                      final currentCode = settingsState.locale?.languageCode ?? 'ar';
                      return _SettingsCard(
                        icon: Icons.translate,
                        label: l10n.language,
                        segments: _SegmentedControl<String>(
                          value: currentCode,
                          options: const [('ar', 'العربية'), ('en', 'English')],
                          onChanged: (code) {
                              context.read<SettingsCubit>().changeLocale(Locale(code));
                              },
                        ),
                      );
                    },
                  ),

                  const SizedBox(height: AppSizes.spacingMedium),
                  BlocBuilder<SettingsCubit, SettingsState>(
                    builder: (context, settingsState) {
                      final mode = settingsState.themeMode;
                      final modeLabel = switch (mode) {
                        ThemeMode.light => l10n.light,
                        ThemeMode.dark => l10n.dark,
                        ThemeMode.system => l10n.system,
                      };
                      return _SettingsCard(
                        icon: Icons.dark_mode_outlined,
                        label: l10n.theme,
                        subtitle: modeLabel,
                        segments: _SegmentedControl<ThemeMode>(
                          value: mode,
                          options: [
                            (ThemeMode.light, l10n.light),
                            (ThemeMode.dark, l10n.dark),
                            (ThemeMode.system, l10n.system),
                          ],
                          onChanged: (m) => context.read<SettingsCubit>().changeTheme(m),
                        ),
                      );
                    },
                  ),

                  const SizedBox(height: AppSizes.spacingMedium),
                  CustomCard(
                    onTap: () => context.pushNamed(RouteNames.privacyPolicy),
                    child: Row(
                      children: [
                        Icon(Icons.privacy_tip_outlined, size: 22, color: AppColors.navyOf(context)),
                        const SizedBox(width: AppSizes.spacingMedium),
                        Expanded(
                          child: Text(l10n.privacyPolicy, style: context.textTheme.titleSmall),
                        ),
                        Icon(
                          Icons.chevron_right,
                          size: AppSizes.iconSizeSmall,
                          color: AppColors.textSecondaryOf(context),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: AppSizes.spacingXLarge),
                  SizedBox(
                    width: double.infinity,
                    height: AppSizes.buttonHeight,
                    child: OutlinedButton.icon(
                      onPressed: () => _confirmLogout(context),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.errorOf(context),
                        side: BorderSide(color: AppColors.errorOf(context), width: 1.5),
                        shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
                        padding: AppPadding.button,
                      ),
                      icon: const Icon(Icons.logout),
                      label: Text(l10n.logout),
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  Text(
                    l10n.appName,
                    textAlign: TextAlign.center,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingSmall),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

// A short, left-aligned section label with a small navy accent bar - the
// shared heading for every block on the screen, so the page scans as a set
// of clearly separated sections.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 3,
          height: 15,
          decoration: BoxDecoration(
            color: AppColors.navyOf(context),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: AppSizes.spacingSmall),
        Expanded(
          child: Text(
            text,
            style: context.textTheme.titleMedium,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

// The identity block: avatar, name, and - when present - the pharmacy as a
// quiet navy chip and the city as a secondary line. Same three values the
// old header row carried, just given room to breathe.
class _IdentityHeader extends StatelessWidget {
  const _IdentityHeader({
    required this.name,
    required this.pharmacyName,
    required this.city,
  });

  final String name;
  final String? pharmacyName;
  final String? city;

  @override
  Widget build(BuildContext context) {
    final primary = AppColors.primaryOf(context);
    final navy = AppColors.navyOf(context);

    return CustomCard(
      padding: const EdgeInsets.all(AppSizes.spacingLarge),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: primary.withValues(alpha: 0.25), width: 2),
            ),
            child: CircleAvatar(
              radius: 30,
              backgroundColor: primary.withValues(alpha: 0.12),
              child: Icon(Icons.person, color: primary, size: 32),
            ),
          ),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: context.textTheme.titleLarge,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (pharmacyName != null && pharmacyName!.isNotEmpty) ...[
                  const SizedBox(height: AppSizes.spacingSmall),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: navy.withValues(alpha: 0.10),
                      borderRadius: AppRadius.badge,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.local_pharmacy_outlined, size: 13, color: navy),
                        const SizedBox(width: AppSizes.spacingXSmall),
                        Flexible(
                          child: Text(
                            pharmacyName!,
                            style: context.textTheme.bodySmall?.copyWith(
                              color: navy,
                              fontWeight: FontWeight.w700,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                if (city != null && city!.isNotEmpty) ...[
                  const SizedBox(height: AppSizes.spacingXSmall + 2),
                  Row(
                    children: [
                      Icon(
                        Icons.location_on_outlined,
                        size: 14,
                        color: AppColors.textSecondaryOf(context),
                      ),
                      const SizedBox(width: AppSizes.spacingXSmall),
                      Flexible(
                        child: Text(
                          city!,
                          style: context.textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondaryOf(context),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
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

// The labelled record - one card, each field as a small secondary label
// sitting above its value, thin dividers between rows. Deliberately plain:
// no icons, no colour, so it reads as a formal information panel.
class _PersonalInfoCard extends StatelessWidget {
  const _PersonalInfoCard({required this.rows});

  final List<({String label, String value})> rows;

  @override
  Widget build(BuildContext context) {
    return CustomCard(
      padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingMedium),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) Divider(height: 1, color: AppColors.borderOf(context)),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingMedium),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rows[i].label,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(rows[i].value, style: context.textTheme.bodyLarge),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// The "nothing here yet" line for the rating / debts sections - a soft
// bordered strip rather than bare text, so an empty section still looks
// intentional.
class _EmptyHint extends StatelessWidget {
  const _EmptyHint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSizes.spacingMedium,
        vertical: AppSizes.spacingMedium,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceOf(context),
        borderRadius: AppRadius.medium,
        border: Border.all(color: AppColors.borderOf(context)),
      ),
      child: Text(
        text,
        style: context.textTheme.bodyMedium?.copyWith(
          color: AppColors.textSecondaryOf(context),
        ),
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

// Restyled to match the individually-bordered review-card pattern
// established on the Warehouse Profile screen, instead of one card with
// dividers between reviews.
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

// Section 16: one row of "my debts" - tapping it opens the read-only detail
// screen (orders + payments) for that one warehouse, see DebtDetailView. The
// design's per-row "last payment date" isn't shown - WarehouseDebtModel
// doesn't carry it.
class _DebtTile extends StatelessWidget {
  const _DebtTile({required this.debt, required this.isArabic, required this.usdToSyp});

  final WarehouseDebtModel debt;
  final bool isArabic;
  final double? usdToSyp;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final name = isArabic ? debt.nameAr : (debt.nameEn ?? debt.nameAr);
    final sypText = formatSypApprox(debt.balanceUsd, usdToSyp, l10n.currencySuffix);

    return InkWell(
      onTap: () => context.pushNamed(
        RouteNames.debtDetail,
        pathParameters: {'warehouseId': debt.warehouseId},
        extra: name,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingSmall),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppColors.surfaceOf(context),
                borderRadius: AppRadius.small,
              ),
              child: Icon(Icons.storefront_outlined, size: 17, color: AppColors.textSecondaryOf(context)),
            ),
            const SizedBox(width: AppSizes.spacingSmall),
            Expanded(
              child: Text(
                name,
                style: context.textTheme.bodyMedium,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: AppSizes.spacingSmall),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '\$${debt.balanceUsd}',
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: AppColors.errorOf(context),
                    fontWeight: FontWeight.bold,
                  ),
                ),
                if (sypText != null)
                  Text(
                    sypText,
                    style: context.textTheme.bodySmall?.copyWith(
                      fontSize: 10.5,
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: AppSizes.spacingXSmall),
            Icon(Icons.chevron_right, size: AppSizes.iconSizeSmall, color: AppColors.textSecondaryOf(context)),
          ],
        ),
      ),
    );
  }
}

// A bordered card with an icon+label(+subtitle) on one side and a segmented
// control on the other - the shared shell for the language and theme rows,
// matching the design's "settings row" pattern.
class _SettingsCard extends StatelessWidget {
  const _SettingsCard({
    required this.icon,
    required this.label,
    this.subtitle,
    required this.segments,
  });

  final IconData icon;
  final String label;
  final String? subtitle;
  final Widget segments;

  @override
  Widget build(BuildContext context) {
    return CustomCard(
      child: Row(
        children: [
          Icon(icon, size: 22, color: AppColors.navyOf(context)),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: context.textTheme.titleSmall),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppSizes.spacingSmall),
          segments,
        ],
      ),
    );
  }
}

class _SegmentedControl<T> extends StatelessWidget {
  const _SegmentedControl({required this.value, required this.options, required this.onChanged});

  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppColors.surfaceOf(context),
        borderRadius: AppRadius.small,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final option in options)
            _SegmentButton(
              label: option.$2,
              selected: option.$1 == value,
              onTap: () => onChanged(option.$1),
            ),
        ],
      ),
    );
  }
}

class _SegmentButton extends StatelessWidget {
  const _SegmentButton({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(9),
      child: Container(
        constraints: const BoxConstraints(minWidth: 46, minHeight: 36),
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: AppSizes.spacingSmall),
        decoration: BoxDecoration(
          color: selected ? AppColors.navyOf(context) : Colors.transparent,
          borderRadius: BorderRadius.circular(9),
        ),
        child: Text(
          label,
          style: context.textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.bold,
            color: selected ? Colors.white : AppColors.textSecondaryOf(context),
          ),
        ),
      ),
    );
  }
}
