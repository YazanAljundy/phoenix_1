import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../constants/app_padding.dart';
import '../constants/app_radius.dart';
import '../constants/app_sizes.dart';

// The app's shared loading-placeholder vocabulary: content-shaped blocks that
// pulse gently while the real data loads, instead of a bare spinner. The
// pattern started as private widgets inside MyOrdersView (and was then
// copy-pasted into MyReturnsView); this is that same look, extracted so every
// screen loads the same way.
//
// A screen describes the *shape* of what is about to appear using
// [SkeletonBar] and [SkeletonCard], then hands it to a layout helper -
// [SkeletonList], [SkeletonGrid] or [SkeletonPage] - each of which wraps the
// whole thing in one [SkeletonPulse]. Compose shapes, not pulses: nesting one
// pulse inside another just fades the same pixels twice.

// Slow enough to read as "loading", never as a blink.
const Duration _kPulsePeriod = Duration(milliseconds: 900);

/// Drives the fade every skeleton on a screen shares, from a single
/// controller, so the whole placeholder breathes as one object.
class SkeletonPulse extends StatefulWidget {
  const SkeletonPulse({super.key, required this.child});

  final Widget child;

  @override
  State<SkeletonPulse> createState() => _SkeletonPulseState();
}

class _SkeletonPulseState extends State<SkeletonPulse>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: _kPulsePeriod,
  )..repeat(reverse: true);

  late final Animation<double> _opacity = Tween<double>(
    begin: 0.5,
    end: 1.0,
  ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(opacity: _opacity, child: widget.child);
  }
}

/// One placeholder block - a stand-in for a line of text, a chip, a
/// thumbnail. A null [width] stretches to the parent, which is what a
/// full-width line of body text wants.
///
/// Filled with the theme's border tone rather than a hardcoded grey, so it
/// stays legible against both the light and the dark surfaces it sits on.
class SkeletonBar extends StatelessWidget {
  const SkeletonBar({
    super.key,
    this.width,
    this.height = 14,
    this.radius = AppRadius.small,
  });

  final double? width;
  final double height;
  final BorderRadius radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.borderOf(context),
        borderRadius: radius,
      ),
    );
  }
}

/// The card chrome a stack of [SkeletonBar]s sits in - the same fill, radius
/// and border as the app's real content cards, so the placeholder occupies
/// the footprint of the thing that replaces it.
class SkeletonCard extends StatelessWidget {
  const SkeletonCard({
    super.key,
    required this.children,
    this.padding = AppPadding.card,
    // Start, not stretch: a stretched column hands its children tight
    // cross-axis constraints, which would silently override every
    // [SkeletonBar.width] and flatten the card into identical full-width
    // bars. Left-aligned, a bar with no width still fills the row and one
    // with a width keeps it.
    this.crossAxisAlignment = CrossAxisAlignment.start,
    this.mainAxisSize = MainAxisSize.min,
  });

  final List<Widget> children;
  final EdgeInsetsGeometry padding;
  final CrossAxisAlignment crossAxisAlignment;
  final MainAxisSize mainAxisSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.surfaceElevatedOf(context),
        borderRadius: AppRadius.large,
        border: Border.all(color: AppColors.borderOf(context)),
      ),
      child: Column(
        crossAxisAlignment: crossAxisAlignment,
        mainAxisSize: mainAxisSize,
        children: children,
      ),
    );
  }
}

/// The default list-row placeholder: a title bar with a status pill beside
/// it, [lines] of detail, and a value at the bottom. That is the shape a row
/// takes nearly everywhere in this app - an order, a return, a complaint, a
/// review - so most screens need nothing more specific than this.
class SkeletonListCard extends StatelessWidget {
  const SkeletonListCard({super.key, this.lines = 1});

  /// How many body lines sit between the header row and the value.
  final int lines;

  @override
  Widget build(BuildContext context) {
    return SkeletonCard(
      children: [
        const Row(
          children: [
            SkeletonBar(width: 90),
            Spacer(),
            SkeletonBar(width: 64, height: 22, radius: AppRadius.full),
          ],
        ),
        const SizedBox(height: AppSizes.spacingMedium),
        for (var line = 0; line < lines; line++) ...[
          if (line > 0) const SizedBox(height: AppSizes.spacingSmall),
          // The last line runs short, the way a wrapped paragraph does.
          SkeletonBar(width: line == lines - 1 ? 160 : null, height: 12),
        ],
        const SizedBox(height: AppSizes.spacingMedium),
        const SkeletonBar(width: 70, height: 18),
      ],
    );
  }
}

/// A vertical run of identical card placeholders - the shape most of the
/// app's loading screens want. [itemBuilder] draws one row.
class SkeletonList extends StatelessWidget {
  const SkeletonList({
    super.key,
    required this.itemBuilder,
    this.itemCount = 4,
    this.padding = AppPadding.screen,
    this.spacing = AppSizes.spacingSmall,
  });

  final IndexedWidgetBuilder itemBuilder;
  final int itemCount;
  final EdgeInsetsGeometry padding;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return SkeletonPulse(
      child: ListView.separated(
        padding: padding,
        // A placeholder is not content: it must not scroll, bounce, or throw
        // an overscroll glow under a finger that arrives before the data.
        physics: const NeverScrollableScrollPhysics(),
        shrinkWrap: true,
        itemCount: itemCount,
        separatorBuilder: (context, index) => SizedBox(height: spacing),
        itemBuilder: itemBuilder,
      ),
    );
  }
}

/// The common case, spelled once: [itemCount] identical [SkeletonListCard]s.
/// A screen only needs the more general [SkeletonList] when its rows are not
/// the standard card shape.
class SkeletonCardList extends StatelessWidget {
  const SkeletonCardList({
    super.key,
    this.itemCount = 4,
    this.lines = 1,
    this.padding = AppPadding.screen,
    this.spacing = AppSizes.spacingSmall,
  });

  final int itemCount;
  final int lines;
  final EdgeInsetsGeometry padding;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return SkeletonList(
      itemCount: itemCount,
      padding: padding,
      spacing: spacing,
      itemBuilder: (context, index) => SkeletonListCard(lines: lines),
    );
  }
}

/// A grid of identical cell placeholders. Takes the screen's real grid
/// metrics so the cells land where the content is about to.
class SkeletonGrid extends StatelessWidget {
  const SkeletonGrid({
    super.key,
    required this.itemBuilder,
    required this.maxCrossAxisExtent,
    required this.mainAxisExtent,
    this.itemCount = 6,
    this.padding = AppPadding.screen,
    this.spacing = AppSizes.spacingMedium,
  });

  final IndexedWidgetBuilder itemBuilder;
  final double maxCrossAxisExtent;
  final double mainAxisExtent;
  final int itemCount;
  final EdgeInsetsGeometry padding;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return SkeletonPulse(
      child: GridView.builder(
        padding: padding,
        physics: const NeverScrollableScrollPhysics(),
        shrinkWrap: true,
        gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: maxCrossAxisExtent,
          mainAxisSpacing: spacing,
          crossAxisSpacing: spacing,
          mainAxisExtent: mainAxisExtent,
        ),
        itemCount: itemCount,
        itemBuilder: itemBuilder,
      ),
    );
  }
}

/// A single-column page placeholder for detail screens, whose content is a
/// stack of distinct blocks rather than a repeating row.
class SkeletonPage extends StatelessWidget {
  const SkeletonPage({
    super.key,
    required this.children,
    this.padding = AppPadding.screen,
  });

  final List<Widget> children;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return SkeletonPulse(
      child: ListView(
        padding: padding,
        physics: const NeverScrollableScrollPhysics(),
        children: children,
      ),
    );
  }
}
