import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:video_player/video_player.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/widgets/app_network_image.dart';
import 'package:feniq/features/banners/data/models/banner_model.dart';
import 'package:feniq/features/banners/presentation/managers/banners_cubit.dart';
import 'package:feniq/features/banners/presentation/managers/banners_state.dart';

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
                          child: _BannerMedia(banner: banner, isActive: index == _currentPage),
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

// Dispatches on the banner's mediaType - image keeps the exact pre-existing
// AppNetworkImage path (caching + right-sizing); video and GIF each need
// their own widget below (see each one's own doc comment for why).
class _BannerMedia extends StatelessWidget {
  const _BannerMedia({required this.banner, required this.isActive});

  final BannerModel banner;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    if (banner.isVideo) {
      return _BannerVideo(url: banner.imageUrl, isActive: isActive);
    }
    if (banner.isGif) {
      return _BannerGifImage(url: banner.imageUrl);
    }
    return AppNetworkImage(url: banner.imageUrl, fit: BoxFit.cover, width: double.infinity);
  }
}

// AppNetworkImage rewrites Cloudinary URLs to a right-sized, decode-capped
// rendition (cloudinary_image.dart) - both the `f_auto`/`q_auto` transform
// and the memCacheWidth/memCacheHeight decode resize can turn an animated
// GIF into a single static frame. A plain Image.network sidesteps both, so
// the GIF's animation is guaranteed to survive.
class _BannerGifImage extends StatelessWidget {
  const _BannerGifImage({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    return Image.network(
      url,
      fit: BoxFit.cover,
      width: double.infinity,
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : Container(color: AppColors.surfaceOf(context)),
      errorBuilder: (context, error, stack) => Container(
        color: AppColors.surfaceOf(context),
        alignment: Alignment.center,
        child: Icon(Icons.image_not_supported_outlined, color: AppColors.textSecondaryOf(context)),
      ),
    );
  }
}

// Autoplay, muted, looping video for an admin banner - plays only while its
// page is the carousel's current one ([isActive]), so at most one video ever
// plays at a time regardless of how many neighboring pages PageView keeps
// built. Re-seeks to the start each time it becomes active again, matching
// the "starts over" feel of an ad slide reappearing.
class _BannerVideo extends StatefulWidget {
  const _BannerVideo({required this.url, required this.isActive});

  final String url;
  final bool isActive;

  @override
  State<_BannerVideo> createState() => _BannerVideoState();
}

class _BannerVideoState extends State<_BannerVideo> {
  VideoPlayerController? _controller;
  bool _isReady = false;

  @override
  void initState() {
    super.initState();
    _initController();
  }

  Future<void> _initController() async {
    final controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _controller = controller;
    try {
      await controller.initialize();
      await controller.setLooping(true);
      await controller.setVolume(0);
      if (!mounted) {
        controller.dispose();
        return;
      }
      setState(() => _isReady = true);
      if (widget.isActive) controller.play();
    } catch (_) {
      // A broken/unreachable video URL just shows the loading block below
      // forever, rather than crashing the slider - same "graceful failure"
      // spirit as AppNetworkImage's error state.
    }
  }

  @override
  void didUpdateWidget(covariant _BannerVideo oldWidget) {
    super.didUpdateWidget(oldWidget);
    final controller = _controller;
    if (controller == null || !_isReady || widget.isActive == oldWidget.isActive) return;
    if (widget.isActive) {
      controller.seekTo(Duration.zero);
      controller.play();
    } else {
      controller.pause();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null || !_isReady) {
      return Container(color: AppColors.surfaceOf(context));
    }
    return FittedBox(
      fit: BoxFit.cover,
      clipBehavior: Clip.hardEdge,
      child: SizedBox(
        width: controller.value.size.width,
        height: controller.value.size.height,
        child: VideoPlayer(controller),
      ),
    );
  }
}
