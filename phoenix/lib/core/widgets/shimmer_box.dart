import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

import '../constants/app_colors.dart';
import '../constants/app_padding.dart';
import '../constants/app_radius.dart';

/// One shimmering placeholder rectangle - the building block for a
/// screen's loading skeleton (Section 2-d of the visual-polish pass:
/// shimmer instead of a plain spinner over card-shaped content).
class ShimmerBox extends StatelessWidget {
  const ShimmerBox({
    super.key,
    this.width,
    this.height = 14,
    this.borderRadius = AppRadius.small,
  });

  final double? width;
  final double height;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.borderOf(context),
        borderRadius: borderRadius,
      ),
    );
  }
}

/// Wraps any skeleton layout (a stack of [ShimmerBox]es, typically) in the
/// moving shimmer sweep. Kept separate from [ShimmerBox] so a screen can
/// build one custom skeleton shape (e.g. a card-shaped layout matching its
/// real content) and shimmer the whole thing as one animation.
class ShimmerLoading extends StatelessWidget {
  const ShimmerLoading({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final base = AppColors.borderOf(context);
    final highlight = isDark ? AppColors.darkSurfaceElevated : Colors.white;
    return Shimmer.fromColors(
      baseColor: base,
      highlightColor: highlight,
      child: child,
    );
  }
}

/// A generic shimmering list of card-shaped placeholders - drop-in
/// replacement for `const AppLoading()` on any screen whose loaded content
/// is a vertical list of cards (orders, returns, debts, warehouses...).
class ShimmerCardList extends StatelessWidget {
  const ShimmerCardList({super.key, this.itemCount = 4, this.cardHeight = 96});

  final int itemCount;
  final double cardHeight;

  @override
  Widget build(BuildContext context) {
    return ShimmerLoading(
      child: ListView.separated(
        padding: AppPadding.screen,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: itemCount,
        separatorBuilder: (context, index) => const SizedBox(height: 12),
        itemBuilder: (context, index) => Container(
          height: cardHeight,
          decoration: BoxDecoration(
            color: AppColors.borderOf(context),
            borderRadius: AppRadius.large,
          ),
        ),
      ),
    );
  }
}
