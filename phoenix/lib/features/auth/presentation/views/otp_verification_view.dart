import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/validators.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/core/widgets/secondary_button.dart';
import 'package:phoenix/features/auth/data/models/registration_draft.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/routes/route_names.dart';

class OtpVerificationView extends StatefulWidget {
  const OtpVerificationView({super.key, required this.draft});

  final RegistrationDraft draft;

  @override
  State<OtpVerificationView> createState() => _OtpVerificationViewState();
}

class _OtpVerificationViewState extends State<OtpVerificationView> {
  final _formKey = GlobalKey<FormState>();
  final _codeController = TextEditingController();

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    context.unfocus();
    if (!_formKey.currentState!.validate()) return;

    final cubit = context.read<AuthCubit>();
    final verified = await cubit.register(
      name: widget.draft.name,
      pharmacyName: widget.draft.pharmacyName,
      phone: widget.draft.phone,
      address: widget.draft.address,
      otpCode: _codeController.text.trim(),
      password: widget.draft.password,
      verificationPhoto: widget.draft.verificationPhoto,
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
        break;
    }
  }

  Future<void> _resend() async {
    final resent = await context.read<AuthCubit>().sendOtp(widget.draft.phone);
    if (resent && mounted) {
      AppSnackbar.show(context, context.l10n.codeResent);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.otpTitle),
      ),
      body: BlocListener<AuthCubit, AuthState>(
        listenWhen: (previous, current) =>
            current.errorMessage != null &&
            previous.errorMessage != current.errorMessage,
        listener: (context, state) {
          AppSnackbar.show(context, state.errorMessage!);
        },
        child: SafeArea(
          child: SingleChildScrollView(
            padding: AppPadding.screen,
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.otpInstructions(widget.draft.phone),
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingLarge),
                  AppTextField(
                    label: l10n.otpCodeLabel,
                    controller: _codeController,
                    keyboardType: TextInputType.number,
                    validator: (value) => Validators.validateOtpCode(
                      value,
                      requiredMessage: l10n.fieldRequired,
                      invalidMessage: l10n.invalidOtpCode,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingXLarge),
                  BlocBuilder<AuthCubit, AuthState>(
                    buildWhen: (previous, current) =>
                        previous.isSubmitting != current.isSubmitting,
                    builder: (context, state) => PrimaryButton(
                      label: l10n.verifyButton,
                      isLoading: state.isSubmitting,
                      onPressed: _verify,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  SecondaryButton(
                    label: l10n.resendCodeButton,
                    onPressed: _resend,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
