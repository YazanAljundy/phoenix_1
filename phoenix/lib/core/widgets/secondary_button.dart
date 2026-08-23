import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../constants/app_padding.dart';
import '../constants/app_radius.dart';
import '../constants/app_sizes.dart';
import 'press_scale.dart';

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({
    super.key,
    required this.label,
    required this.onPressed,
  });

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return PressScale(
      child: SizedBox(
        width: double.infinity,
        height: AppSizes.buttonHeight,
        child: OutlinedButton(
          onPressed: onPressed,
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.primaryOf(context),
            side: BorderSide(color: AppColors.borderOf(context)),
            shape: const RoundedRectangleBorder(borderRadius: AppRadius.medium),
            padding: AppPadding.button,
          ),
          child: Text(label),
        ),
      ),
    );
  }
}
