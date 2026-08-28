import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/validators.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/auth/data/models/registration_draft.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/routes/route_names.dart';

const int _otpLength = 6;
const Duration _resendCooldown = Duration(seconds: 60);

class OtpVerificationView extends StatefulWidget {
  const OtpVerificationView({super.key, required this.draft});

  final RegistrationDraft draft;

  @override
  State<OtpVerificationView> createState() => _OtpVerificationViewState();
}

class _OtpVerificationViewState extends State<OtpVerificationView> {
  final _formKey = GlobalKey<FormState>();
  final _codeController = TextEditingController();
  final _codeFocusNode = FocusNode();
  Timer? _cooldownTimer;
  Duration _remaining = _resendCooldown;

  @override
  void initState() {
    super.initState();
    _startCooldown();
  }

  @override
  void dispose() {
    _codeController.dispose();
    _codeFocusNode.dispose();
    _cooldownTimer?.cancel();
    super.dispose();
  }

  void _startCooldown() {
    _cooldownTimer?.cancel();
    setState(() => _remaining = _resendCooldown);
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      if (_remaining <= const Duration(seconds: 1)) {
        timer.cancel();
        setState(() => _remaining = Duration.zero);
        return;
      }
      setState(() => _remaining -= const Duration(seconds: 1));
    });
  }

  // TODO(re-enable-otp): this whole view is currently unreachable (no route
  // pushes here anymore - see registration_view.dart, which now calls
  // cubit.register() directly). Kept compiling, not deleted, for when OTP
  // comes back: AuthCubit.register() will need an otpCode param again, and
  // _codeController.text should be passed through here as before.
  Future<void> _verify() async {
    context.unfocus();
    if (!_formKey.currentState!.validate()) return;

    final cubit = context.read<AuthCubit>();
    final verified = await cubit.register(
      name: widget.draft.name,
      pharmacyName: widget.draft.pharmacyName,
      phone: widget.draft.phone,
      address: widget.draft.address,
      password: widget.draft.password,
    );
    if (!verified || !mounted) return;

    switch (cubit.state.sessionStatus) {
      case SessionStatus.pendingApproval:
      case SessionStatus.blocked:
        context.goNamed(RouteNames.approvalPending);
      case SessionStatus.active:
        context.goNamed(RouteNames.warehouseSelection);
      case SessionStatus.unknown:
      case SessionStatus.unauthenticated:
      case SessionStatus.offline:
        break;
    }
  }

  Future<void> _resend() async {
    if (_remaining > Duration.zero) return;
    final resent = await context.read<AuthCubit>().sendOtp(widget.draft.phone);
    if (!mounted) return;
    if (resent) {
      AppSnackbar.show(context, context.l10n.codeResent);
      _startCooldown();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final canResend = _remaining <= Duration.zero;
    final minutes = _remaining.inMinutes;
    final seconds = _remaining.inSeconds % 60;
    final timerText = '$minutes:${seconds.toString().padLeft(2, '0')}';

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.otpTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
      body: BlocListener<AuthCubit, AuthState>(
        listenWhen: (previous, current) =>
            current.errorMessage != null &&
            previous.errorMessage != current.errorMessage,
        listener: (context, state) {
          AppSnackbar.show(
            context,
            translateErrorCode(context.l10n, state.errorCode, state.errorMessage!),
          );
        },
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              return SingleChildScrollView(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 480),
                    child: Padding(
                      padding: AppPadding.screen,
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _Header(phone: widget.draft.phone),
                            const SizedBox(height: AppSizes.spacingXLarge),
                            FormField<String>(
                              validator: (_) => Validators.validateOtpCode(
                                _codeController.text,
                                requiredMessage: l10n.fieldRequired,
                                invalidMessage: l10n.invalidOtpCode,
                              ),
                              builder: (field) => Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  _OtpCodeInput(
                                    controller: _codeController,
                                    focusNode: _codeFocusNode,
                                    hasError: field.hasError,
                                    onChanged: (value) => field.didChange(value),
                                  ),
                                  if (field.hasError) ...[
                                    const SizedBox(height: AppSizes.spacingXSmall),
                                    Text(
                                      field.errorText!,
                                      textAlign: TextAlign.center,
                                      style: context.textTheme.bodySmall?.copyWith(
                                        color: AppColors.errorOf(context),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            const SizedBox(height: AppSizes.spacingLarge),
                            Column(
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      Icons.timer_outlined,
                                      size: AppSizes.iconSizeSmall,
                                      color: canResend
                                          ? AppColors.textSecondaryOf(context)
                                          : AppColors.navyOf(context),
                                    ),
                                    const SizedBox(width: AppSizes.spacingXSmall),
                                    Text(
                                      timerText,
                                      textDirection: TextDirection.ltr,
                                      style: context.textTheme.bodyMedium?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        color: canResend
                                            ? AppColors.textSecondaryOf(context)
                                            : AppColors.navyOf(context),
                                      ),
                                    ),
                                  ],
                                ),
                                TextButton(
                                  onPressed: canResend ? _resend : null,
                                  child: Text(l10n.resendCodeButton),
                                ),
                              ],
                            ),
                            const SizedBox(height: AppSizes.spacingLarge),
                            BlocBuilder<AuthCubit, AuthState>(
                              buildWhen: (previous, current) =>
                                  previous.isSubmitting != current.isSubmitting,
                              builder: (context, state) => PrimaryButton(
                                label: l10n.verifyButton,
                                isLoading: state.isSubmitting,
                                onPressed: _verify,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.phone});

  final String phone;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            color: AppColors.navyOf(context).withValues(alpha: 0.1),
            borderRadius: AppRadius.large,
          ),
          child: Icon(Icons.sms_outlined, color: AppColors.navyOf(context), size: 28),
        ),
        const SizedBox(height: AppSizes.spacingMedium),
        Text(l10n.otpTitle, style: context.textTheme.displaySmall),
        const SizedBox(height: AppSizes.spacingXSmall),
        Text.rich(
          TextSpan(
            style: context.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondaryOf(context)),
            children: [
              TextSpan(text: '${l10n.otpInstructionsPrefix} '),
              TextSpan(
                text: phone,
                style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textOf(context)),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// Six visual boxes reading a single, real (but invisible) TextField - not
// six chained focus nodes. Keeping one real field is what lets the OS's own
// SMS-autofill suggestion still work (autofillHints below); a fully custom
// on-screen keypad would look closer to the reference design but silently
// breaks that, which matters more for a code that arrives by SMS.
class _OtpCodeInput extends StatelessWidget {
  const _OtpCodeInput({
    required this.controller,
    required this.focusNode,
    required this.hasError,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool hasError;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => focusNode.requestFocus(),
      child: Stack(
        alignment: Alignment.center,
        children: [
          AnimatedBuilder(
            animation: Listenable.merge([controller, focusNode]),
            builder: (context, _) {
              final text = controller.text;
              return Directionality(
                textDirection: TextDirection.ltr,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: List.generate(_otpLength, (index) {
                    final filled = index < text.length;
                    final isCurrent = index == text.length && focusNode.hasFocus;
                    final Color borderColor;
                    final Color fillColor;
                    if (hasError) {
                      borderColor = AppColors.errorOf(context);
                      fillColor = Colors.transparent;
                    } else if (isCurrent) {
                      borderColor = AppColors.primaryOf(context);
                      fillColor = AppColors.primaryOf(context).withValues(alpha: 0.08);
                    } else {
                      borderColor = AppColors.borderOf(context);
                      fillColor = AppColors.surfaceOf(context);
                    }
                    return Expanded(
                      child: Padding(
                        padding: EdgeInsets.symmetric(
                          horizontal: index == 0 || index == _otpLength - 1 ? 0 : 3,
                        ),
                        child: AspectRatio(
                          aspectRatio: 0.86,
                          child: Container(
                            decoration: BoxDecoration(
                              borderRadius: AppRadius.medium,
                              border: Border.all(color: borderColor, width: 2),
                              color: fillColor,
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              filled ? text[index] : '',
                              style: context.textTheme.displaySmall?.copyWith(fontSize: 22),
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                ),
              );
            },
          ),
          Opacity(
            opacity: 0,
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              maxLength: _otpLength,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              autofillHints: const [AutofillHints.oneTimeCode],
              onChanged: onChanged,
              decoration: const InputDecoration(counterText: '', border: InputBorder.none),
            ),
          ),
        ],
      ),
    );
  }
}
