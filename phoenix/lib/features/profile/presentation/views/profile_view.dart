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
import 'package:phoenix/features/settings/presentation/managers/settings_cubit.dart';
import 'package:phoenix/features/settings/presentation/managers/settings_state.dart';
import 'package:phoenix/routes/route_names.dart';

// Section 6.10: name, pharmacy name, phone, language switch, logout - the
// last screen for the pharmacist. Theme switching rides along too (it was
// already working via SettingsCubit before this screen existed); it's just
// not the focus, so it's a secondary control rather than a primary one.
//
// The screen is laid out as labelled sections (identity header -> personal
// information -> ratings -> complaints -> settings -> account actions). The
// ratings section is a link to the full list (PharmacyReviewsView), not the
// list itself; the debts section was removed entirely - debts live on the
// Account History tab now. ProfileView holds no cubit of its own beyond the
// app-wide Auth/Settings ones.
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
                  _SectionHeader(l10n.ratingsTitle),
                  const SizedBox(height: AppSizes.spacingSmall),
                  // The full ratings/reviews list moved to its own page
                  // (PharmacyReviewsView) - Profile now only links to it, the
                  // same way the Complaints row below works.
                  _ProfileNavCard(
                    icon: Icons.star_outline_rounded,
                    title: l10n.ratingsTitle,
                    subtitle: l10n.viewRatingsLabel,
                    onTap: () => context.pushNamed(RouteNames.pharmacyReviews),
                  ),

                  const SizedBox(height: AppSizes.spacingXLarge),
                  _SectionHeader(l10n.complaintsTitle),
                  const SizedBox(height: AppSizes.spacingSmall),
                  _ProfileNavCard(
                    icon: Icons.support_agent_outlined,
                    title: l10n.complaintsTitle,
                    subtitle: l10n.complaintsProfileSubtitle,
                    onTap: () => context.pushNamed(RouteNames.complaints),
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

// A tappable row card - icon, title, secondary subtitle, trailing chevron -
// the shared shell for the Ratings and Complaints entries, both of which just
// navigate to their own full page.
class _ProfileNavCard extends StatelessWidget {
  const _ProfileNavCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return CustomCard(
      onTap: onTap,
      child: Row(
        children: [
          Icon(icon, size: 22, color: AppColors.navyOf(context)),
          const SizedBox(width: AppSizes.spacingMedium),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: context.textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(
                  subtitle,
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
