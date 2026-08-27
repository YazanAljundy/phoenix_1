import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/widgets/app_network_image.dart';
import 'package:phoenix/features/banners/data/models/banner_model.dart';
import 'package:phoenix/features/banners/presentation/managers/banners_cubit.dart';
import 'package:phoenix/features/banners/presentation/managers/banners_state.dart';

// Section: sits directly above the warehouse list on WarehouseSelectionView.
// Entirely self-contained - reads its own BannersCubit and renders nothing
// at all (not a placeholder) unless there's at least one active banner to
// show, per the request.
class BannerSlider extends StatelessWidget {
  const BannerSlider({super.key, this.onBannerTap});

  final ValueChanged<BannerModel>? onBannerTap;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<BannersCubit, BannersState>(
      buildWhen: (previous, current) =>
          previous.status != current.status || previous.banners != current.banners,
      builder: (context, state) {
        if (state.status != BannersStatus.loaded || state.banners.isEmpty) {
          return const SizedBox.shrink();
        }
        return _BannerCarousel(banners: state.banners, onTap: onBannerTap);
      },
    );
  }
}

class _BannerCarousel extends StatefulWidget {
  const _BannerCarousel({required this.banners, this.onTap});

  final List<BannerModel> banners;
  final ValueChanged<BannerModel>? onTap;

  @override
  State<_BannerCarousel> createState() => _BannerCarouselState();
}

class _BannerCarouselState extends State<_BannerCarousel> {
  final _pageController = PageController();
  Timer? _autoScrollTimer;
  int _currentPage = 0;

  @override
  void initState() {
    super.initState();
    // A single banner has nothing to auto-scroll (or swipe) between, per
    // the request.
    if (widget.banners.length > 1) _startAutoScroll();
  }

  void _startAutoScroll() {
    _autoScrollTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!_pageController.hasClients) return;
      final next = (_currentPage + 1) % widget.banners.length;
      _pageController.animateToPage(
        next,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeInOut,
      );
    });
  }

  // Permanent, not paused-then-resumed - once the pharmacist has taken
  // manual control, auto-advancing again would fight their own swipe.
  void _stopAutoScroll() {
    _autoScrollTimer?.cancel();
    _autoScrollTimer = null;
  }

  @override
  void dispose() {
    _autoScrollTimer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSizes.spacingMedium,
        AppSizes.spacingMedium,
        AppSizes.spacingMedium,
        0,
      ),
      child: Center(
        child: ConstrainedBox(
          // Full width on a phone, capped on a tablet - see
          // RegistrationView for the same treatment.
          constraints: const BoxConstraints(maxWidth: 560),
          child: Column(
            children: [
              ClipRRect(
                borderRadius: AppRadius.large,
                child: SizedBox(
                  height: 160,
                  width: double.infinity,
                  child: NotificationListener<ScrollNotification>(
                    onNotification: (notification) {
                      // dragDetails is only set for a real user-initiated
                      // drag, never for the programmatic animateToPage
                      // above - this is how the two are told apart.
                      if (notification is ScrollStartNotification && notification.dragDetails != null) {
                        _stopAutoScroll();
                      }
                      return false;
                    },
                    child: PageView.builder(
                      controller: _pageController,
                      itemCount: widget.banners.length,
                      onPageChanged: (index) => setState(() => _currentPage = index),
                      itemBuilder: (context, index) {
                        final banner = widget.banners[index];
                        return GestureDetector(
                          onTap: banner.isTappable ? () => widget.onTap?.call(banner) : null,
                          child: AppNetworkImage(
                            url: banner.imageUrl,
                            fit: BoxFit.cover,
                            width: double.infinity,
                          ),
                        );
                      },
                    ),
                  ),
                ),
              ),
              if (widget.banners.length > 1) ...[
                const SizedBox(height: AppSizes.spacingSmall),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(widget.banners.length, (index) {
                    final isActive = index == _currentPage;
                    return AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: isActive ? 18 : 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: isActive ? AppColors.primaryOf(context) : AppColors.borderOf(context),
                        borderRadius: AppRadius.full,
                      ),
                    );
                  }),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
