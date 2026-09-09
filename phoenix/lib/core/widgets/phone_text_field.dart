import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../constants/app_colors.dart';
import '../constants/app_padding.dart';
import '../constants/app_radius.dart';
import '../constants/app_sizes.dart';
import '../extensions/build_context_extensions.dart';

// A fixed, non-editable "09" box beside a digits-only field, label above -
// same visual language as AppTextField, just for the one field shaped
// differently everywhere it appears (registration, login).
//
// Syrian mobile numbers are 09XXXXXXXX locally, so the box carries the whole
// "09" the user would otherwise retype on every screen and the field holds
// only the 8 subscriber digits after it.
//
// `controller` therefore holds ONLY those subscriber digits (e.g.
// "55123456"), never the "09" and never the "+963" - callers that need the
// full backend-expected number build it themselves via
// [phoneTextFieldFullValue], which does the prefixing in exactly one place so
// it can not drift between a screen's validator and its submit call.
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
              constraints: const BoxConstraints(minHeight: AppSizes.inputHeight, minWidth: 52),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.surfaceElevatedOf(context),
                borderRadius: AppRadius.small,
                border: Border.all(color: AppColors.borderOf(context)),
              ),
              child: Text(
                phoneLocalPrefix,
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
                  hintText: '55 123 456',
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

/// The fixed, non-editable prefix rendered beside the field.
const String phoneLocalPrefix = '09';

/// The international dialling code the backend stores numbers under.
const String phoneCountryCode = '+963';

/// The subscriber digits that follow the fixed [phoneLocalPrefix] box.
///
/// Normally this is exactly what the user typed, because the box already
/// supplies the "09". A *pasted* number can still carry a prefix of its own,
/// though - the field's digitsOnly formatter drops the "+" but not the digits
/// behind it - so every redundant prefix is peeled off here. Without this a
/// paste would be double-prefixed ("+963" + "963955123456").
///
/// | Field holds     | Subscriber digits |
/// | --------------- | ----------------- |
/// | `55123456`      | `55123456`        |
/// | `955123456`     | `55123456`        |
/// | `0955123456`    | `55123456`        |
/// | `963955123456`  | `55123456`        |
///
/// Anything that peels down to some other shape is returned as-is, so
/// [Validators.validatePhone] stays the one thing that rejects it - this
/// helper never tries to "repair" a malformed number, and deliberately
/// imposes no length limit of its own.
String phoneTextFieldSubscriberDigits(String fieldValue) {
  var digits = fieldValue.replaceAll(RegExp(r'\D'), '');

  if (digits.startsWith('963')) digits = digits.substring(3);
  if (digits.startsWith('0')) digits = digits.substring(1);
  // What is left is either the bare 8 subscriber digits (the normal case -
  // the "09" box supplied the mobile 9) or a whole 9-digit local number that
  // still carries that 9 of its own.
  if (digits.length == 9 && digits.startsWith('9')) digits = digits.substring(1);

  return digits;
}

/// The field's contents -> the full international number the backend stores
/// and matches on (`+9639XXXXXXXX`).
///
/// Empty in, empty out, so an untouched field reports "required" rather than
/// "invalid" through [Validators.validatePhone].
String phoneTextFieldFullValue(String fieldValue) {
  final subscriber = phoneTextFieldSubscriberDigits(fieldValue);
  if (subscriber.isEmpty) return '';
  return '${phoneCountryCode}9$subscriber';
}
