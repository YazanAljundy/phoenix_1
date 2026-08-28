import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/error/error_translator.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/validators.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/features/auth/presentation/utils/login_phone_normalizer.dart';
import 'package:phoenix/routes/route_names.dart';

// Section 6-2: the returning-user alternative to the OTP flow - phone +
// password, no SMS round-trip. Only reachable via the link on
// RegistrationView; password is set once, at initial registration.
class PasswordLoginView extends StatefulWidget {
  const PasswordLoginView({super.key});

  @override
  State<PasswordLoginView> createState() => _PasswordLoginViewState();
}

class _PasswordLoginViewState extends State<PasswordLoginView> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void dispose() {
    _phoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    context.unfocus();
    if (!_formKey.currentState!.validate()) return;

    final cubit = context.read<AuthCubit>();

    // Backend expects the international form (+9639XXXXXXXX); the field
    // accepts several local shapes, so normalize here - right before the
    // call - rather than in AuthCubit, keeping this login-only.
    final originalPhone = _phoneController.text;
    final normalizedPhone = normalizeLoginPhone(originalPhone);

    // TEMP DIAGNOSTIC LOG (phone-normalization task) - never logs the password.
    debugPrint(
      'LOGIN_PHONE_DEBUG: original="$originalPhone" -> normalized="$normalizedPhone" '
      '-> loginWithPassword(phone: "$normalizedPhone")',
    );

    final verified = await cubit.loginWithPassword(
      phone: normalizedPhone,
      password: _passwordController.text,
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

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.passwordLoginTitle),
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
          child: SingleChildScrollView(
            padding: AppPadding.screen,
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(
                    child: Image(
                      image: AssetImage('assets/images/feniq_logo.png'),
                      width: 150,
                      fit: BoxFit.contain,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingLarge),
                  Text(
                    l10n.passwordLoginSubtitle,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingLarge),
                  AppTextField(
                    label: l10n.phoneLabel,
                    controller: _phoneController,
                    keyboardType: TextInputType.phone,
                    // Validate the normalized value so every accepted local
                    // shape (09.., 9.., 963.., +963..) passes the existing
                    // rule without changing the shared Validators.
                    validator: (value) => Validators.validatePhone(
                      normalizeLoginPhone(value ?? ''),
                      requiredMessage: l10n.fieldRequired,
                      invalidMessage: l10n.invalidPhoneNumber,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  AppTextField(
                    label: l10n.password,
                    controller: _passwordController,
                    obscureText: true,
                    validator: (value) =>
                        Validators.validateRequired(value, l10n.fieldRequired),
                  ),
                  const SizedBox(height: AppSizes.spacingXLarge),
                  BlocBuilder<AuthCubit, AuthState>(
                    buildWhen: (previous, current) =>
                        previous.isSubmitting != current.isSubmitting,
                    builder: (context, state) => PrimaryButton(
                      label: l10n.login,
                      isLoading: state.isSubmitting,
                      onPressed: _submit,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  Center(
                    child: TextButton(
                      onPressed: () => context.pushReplacementNamed(RouteNames.registration),
                      child: Text(l10n.backToRegistrationLink),
                    ),
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
