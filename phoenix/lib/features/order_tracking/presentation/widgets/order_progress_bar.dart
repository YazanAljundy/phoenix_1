import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';

// Section 6.7: a horizontal progress bar across five stages, with an
// animated icon marking the current one - 'cancelled' never reaches this
// widget at all (OrderTrackingView shows a distinct cancelled state instead).
class OrderProgressBar extends StatefulWidget {
  const OrderProgressBar({super.key, required this.currentStageIndex});

  final int currentStageIndex;

  @override
  State<OrderProgressBar> createState() => _OrderProgressBarState();
}

class _OrderProgressBarState extends State<OrderProgressBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;

  static const _icons = [
    Icons.send_outlined,
    Icons.fact_check_outlined,
    Icons.inventory_2_outlined,
    Icons.local_shipping_outlined,
    Icons.check_circle_outline,
  ];

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final labels = [
      l10n.stageSent,
      l10n.stageUnderReview,
      l10n.stagePreparing,
      l10n.stageOutForDelivery,
      l10n.stageDelivered,
    ];
    final progress = widget.currentStageIndex / (labels.length - 1);

    return LayoutBuilder(
      builder: (context, constraints) {
        const dotSize = 32.0;
        final trackWidth = constraints.maxWidth - dotSize;

        return Column(
          children: [
            SizedBox(
              height: dotSize,
              child: Stack(
                alignment: Alignment.centerLeft,
                children: [
                  Positioned(
                    left: dotSize / 2,
                    right: dotSize / 2,
                    child: Container(height: 3, color: AppColors.borderOf(context)),
                  ),
                  Positioned(
                    left: dotSize / 2,
                    child: Container(
                      width: trackWidth * progress,
                      height: 3,
                      color: AppColors.secondaryOf(context),
                    ),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: List.generate(labels.length, (index) {
                      final isCompleted = index < widget.currentStageIndex;
                      final isCurrent = index == widget.currentStageIndex;

                      final dot = _StageDot(
                        icon: _icons[index],
                        completed: isCompleted,
                        current: isCurrent,
                      );

                      if (!isCurrent) return dot;

                      return ScaleTransition(
                        scale: Tween(begin: 0.88, end: 1.12).animate(
                          CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
                        ),
                        child: dot,
                      );
                    }),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: List.generate(
                labels.length,
                (index) => Expanded(
                  child: Text(
                    labels[index],
                    textAlign: TextAlign.center,
                    style: context.textTheme.bodyMedium?.copyWith(
                      fontSize: 11,
                      fontWeight: index == widget.currentStageIndex
                          ? FontWeight.bold
                          : FontWeight.normal,
                      color: index <= widget.currentStageIndex
                          ? AppColors.textOf(context)
                          : AppColors.textSecondaryOf(context),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _StageDot extends StatelessWidget {
  const _StageDot({required this.icon, required this.completed, required this.current});

  final IconData icon;
  final bool completed;
  final bool current;

  @override
  Widget build(BuildContext context) {
    final Color backgroundColor;
    final Color iconColor;
    if (completed) {
      backgroundColor = AppColors.secondaryOf(context);
      iconColor = Colors.white;
    } else if (current) {
      backgroundColor = AppColors.primaryOf(context);
      iconColor = Colors.white;
    } else {
      backgroundColor = AppColors.surfaceOf(context);
      iconColor = AppColors.textSecondaryOf(context);
    }

    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color: backgroundColor,
        shape: BoxShape.circle,
        border: completed || current
            ? null
            : Border.all(color: AppColors.borderOf(context)),
      ),
      child: Icon(completed ? Icons.check : icon, size: 16, color: iconColor),
    );
  }
}
