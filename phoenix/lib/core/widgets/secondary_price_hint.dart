import 'package:flutter/material.dart';
import 'package:phoenix/core/constants/app_colors.dart';

// A small secondary price hint ("| ~ $11.50") rendered next to a SYP-primary
// price, showing the exact USD figure it was converted from - see
// core/utils/currency_formatter.dart for the text itself.
class SecondaryPriceHint extends StatelessWidget {
  const SecondaryPriceHint({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      '| $text',
      style: TextStyle(color: AppColors.textSecondaryOf(context), fontSize: 12),
    );
  }
}
