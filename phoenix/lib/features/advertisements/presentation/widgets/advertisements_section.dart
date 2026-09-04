import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/features/advertisements/presentation/managers/advertisements_cubit.dart';
import 'package:phoenix/features/advertisements/presentation/managers/advertisements_state.dart';
import 'package:phoenix/features/advertisements/presentation/widgets/advertisement_card.dart';

// Sits directly under the banner slider on WarehouseSelectionView. Entirely
// self-contained, and - exactly like BannerSlider - renders NOTHING at all
// (not a placeholder, not an error box) unless there is at least one live
// package to show: a slow or failed advertisement fetch must never disturb the
// warehouse list this screen exists for.
class AdvertisementsSection extends StatelessWidget {
  const AdvertisementsSection({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return BlocBuilder<AdvertisementsCubit, AdvertisementsState>(
      buildWhen: (previous, current) =>
          previous.status != current.status ||
          previous.advertisements != current.advertisements,
      builder: (context, state) {
        if (state.status != AdvertisementsStatus.loaded || state.advertisements.isEmpty) {
          return const SizedBox.shrink();
        }

        return Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSizes.spacingMedium,
            AppSizes.spacingMedium,
            AppSizes.spacingMedium,
            0,
          ),
          child: Center(
            // Full width on a phone, capped on a tablet - the same treatment
            // BannerSlider gives its carousel.
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSizes.spacingSmall),
                    child: Text(
                      l10n.advertisementsSectionTitle,
                      style: context.textTheme.titleMedium,
                    ),
                  ),
                  for (final advertisement in state.advertisements)
                    AdvertisementCard(advertisement: advertisement),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
