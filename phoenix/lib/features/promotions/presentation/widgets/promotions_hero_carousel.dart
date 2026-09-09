import 'package:flutter/material.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_radius.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/features/promotions/data/models/promotion.dart';

import 'promotion_hero_card.dart';

/// The featured strip at the top of the Offers & Ads tab.
///
/// Swipe-only, on purpose: this screen is meant to feel unhurried, and the
/// existing auto-advancing carousel in the app is a passive banner strip on a
/// screen the pharmacist is only passing through. Here the cards ARE the
/// content, so nothing moves under their thumb while they are reading a price.
/// The dots say how many there are and where they are.
class PromotionsHeroCarousel extends StatefulWidget {
  const PromotionsHeroCarousel({
    super.key,
    required this.promotions,
    required this.onPromotionTap,
  });

  final List<Promotion> promotions;
  final ValueChanged<Promotion> onPromotionTap;

  @override
  State<PromotionsHeroCarousel> createState() => _PromotionsHeroCarouselState();
}

class _PromotionsHeroCarouselState extends State<PromotionsHeroCarousel> {
  // A sliver of the neighbouring card peeks in, which is what tells the
  // pharmacist there is more to swipe to without needing an arrow or a hint.
  late final PageController _pageController = PageController(viewportFraction: 0.92);
  int _currentPage = 0;

  @override
  void didUpdateWidget(covariant PromotionsHeroCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A filter can shrink the strip out from under the current page.
    if (_currentPage >= widget.promotions.length && widget.promotions.isNotEmpty) {
      _currentPage = 0;
      if (_pageController.hasClients) _pageController.jumpToPage(0);
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.promotions.isEmpty) return const SizedBox.shrink();

    return Column(
      children: [
        SizedBox(
          height: PromotionHeroCard.height,
          child: PageView.builder(
            controller: _pageController,
            itemCount: widget.promotions.length,
            padEnds: false,
            onPageChanged: (index) => setState(() => _currentPage = index),
            itemBuilder: (context, index) {
              final promotion = widget.promotions[index];
              return Padding(
                padding: const EdgeInsetsDirectional.only(end: AppSizes.spacingSmall + 2),
                child: PromotionHeroCard(
                  promotion: promotion,
                  onTap: () => widget.onPromotionTap(promotion),
                ),
              );
            },
          ),
        ),
        if (widget.promotions.length > 1) ...[
          const SizedBox(height: AppSizes.spacingSmall + 2),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(widget.promotions.length, (index) {
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
    );
  }
}
