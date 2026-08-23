import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../constants/app_colors.dart';
import '../constants/app_padding.dart';
import '../constants/app_radius.dart';
import '../constants/app_sizes.dart';
import '../extensions/build_context_extensions.dart';

// Label sits above the field (not floating inside its border, Material's
// default) - every field in the reference design uses this shape, and it
// reads more clearly in Arabic than a floating label does. `hint` is the
// grey example text shown inside the empty field itself (e.g. "مثال: ...") -
// optional, so existing call sites that don't pass one just render label +
// plain field, same behavior as before.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.obscureText = false,
    this.validator,
    this.keyboardType,
    this.inputFormatters,
    this.prefixIcon,
    this.suffixIcon,
    this.maxLines = 1,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final bool obscureText;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final Widget? prefixIcon;
  final Widget? suffixIcon;
  final int maxLines;
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
        TextFormField(
          controller: controller,
          obscureText: obscureText,
          keyboardType: keyboardType,
          inputFormatters: inputFormatters,
          validator: validator,
          onChanged: onChanged,
          maxLines: obscureText ? 1 : maxLines,
          style: context.textTheme.bodyMedium,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: context.textTheme.bodyMedium?.copyWith(
              color: AppColors.textSecondaryOf(context).withValues(alpha: 0.7),
            ),
            prefixIcon: prefixIcon,
            suffixIcon: suffixIcon,
            isDense: true,
            // Same content padding and minHeight floor regardless of
            // maxLines, so single-line fields all render at exactly
            // AppSizes.inputHeight - a multi-line field just grows past
            // that floor as needed, it never shrinks below it either.
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
      ],
    );
  }
}
