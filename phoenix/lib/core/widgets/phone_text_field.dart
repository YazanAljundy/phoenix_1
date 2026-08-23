import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../constants/app_colors.dart';
import '../constants/app_padding.dart';
import '../constants/app_radius.dart';
import '../constants/app_sizes.dart';
import '../extensions/build_context_extensions.dart';

// A fixed, non-editable "+963" box beside a digits-only field, label above -
// same visual language as AppTextField, just for the one field shaped
// differently everywhere it appears (registration, login).
//
// `controller` holds ONLY the local digits the user types (e.g.
// "955123456"), never the "+963" - callers that need the full
// backend-expected number (Validators.validatePhone accepts either a
// "+963" or a leading "0") build it themselves via [phoneTextFieldFullValue],
// which does the "+963" concatenation in exactly one place so it can't drift
// between a screen's validator and its submit call.
class PhoneTextField extends StatelessWidget {
  const PhoneTextField({
    super.key,
    required this.label,
    required this.controller,
    this.validator,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String? Function(String?)? validator;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: context.textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w700,
            color: AppColors.textSecondaryOf(context),
          ),
        ),
        const SizedBox(height: AppSizes.spacingXSmall),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              constraints: const BoxConstraints(minHeight: AppSizes.inputHeight, minWidth: 66),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.surfaceElevatedOf(context),
                borderRadius: AppRadius.small,
                border: Border.all(color: AppColors.borderOf(context)),
              ),
              child: Text(
                phoneCountryCode,
                textDirection: TextDirection.ltr,
                style: context.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.textSecondaryOf(context),
                ),
              ),
            ),
            const SizedBox(width: AppSizes.spacingSmall),
            Expanded(
              child: TextFormField(
                controller: controller,
                keyboardType: TextInputType.phone,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                validator: validator,
                onChanged: onChanged,
                textDirection: TextDirection.ltr,
                textAlign: TextAlign.right,
                style: context.textTheme.bodyMedium,
                decoration: InputDecoration(
                  hintText: '955 123 456',
                  hintStyle: context.textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondaryOf(context).withValues(alpha: 0.7),
                  ),
                  isDense: true,
                  contentPadding: AppPadding.input,
                  constraints: const BoxConstraints(minHeight: AppSizes.inputHeight),
                  filled: true,
                  fillColor: AppColors.surfaceOf(context),
                  border: OutlineInputBorder(
                    borderRadius: AppRadius.small,
                    borderSide: BorderSide(color: AppColors.borderOf(context)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: AppRadius.small,
                    borderSide: BorderSide(color: AppColors.borderOf(context)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: AppRadius.small,
                    borderSide: BorderSide(color: AppColors.primaryOf(context), width: 1.5),
                  ),
                  errorBorder: OutlineInputBorder(
                    borderRadius: AppRadius.small,
                    borderSide: BorderSide(color: AppColors.errorOf(context)),
                  ),
                  focusedErrorBorder: OutlineInputBorder(
                    borderRadius: AppRadius.small,
                    borderSide: BorderSide(color: AppColors.errorOf(context), width: 1.5),
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

const String phoneCountryCode = '+963';

// A local digits value (e.g. "955123456" or "0955123456") -> the full
// value the backend/Validators.validatePhone expects. Strips a leading 0
// first so a pasted local-format number ("0955123456") doesn't end up
// double-prefixed ("+9630955123456").
String phoneTextFieldFullValue(String localDigits) {
  final digits = localDigits.trim();
  final withoutLeadingZero = digits.startsWith('0') ? digits.substring(1) : digits;
  return '$phoneCountryCode$withoutLeadingZero';
}
