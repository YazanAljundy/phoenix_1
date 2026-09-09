import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:feniq/core/constants/app_colors.dart';
import 'package:feniq/core/constants/app_padding.dart';
import 'package:feniq/core/constants/app_sizes.dart';
import 'package:feniq/core/error/error_translator.dart';
import 'package:feniq/core/extensions/build_context_extensions.dart';
import 'package:feniq/core/utils/validators.dart';
import 'package:feniq/core/widgets/app_snackbar.dart';
import 'package:feniq/core/widgets/app_text_field.dart';
import 'package:feniq/core/widgets/brand_logo.dart';
import 'package:feniq/core/widgets/phone_text_field.dart';
import 'package:feniq/core/widgets/primary_button.dart';
import 'package:feniq/features/auth/presentation/managers/auth_cubit.dart';
import 'package:feniq/features/auth/presentation/managers/auth_state.dart';
import 'package:feniq/routes/route_names.dart';

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

    final verified = await cubit.loginWithPassword(
      // The field only ever holds the subscriber digits after the fixed "09"
      // box (see PhoneTextField) - this composes the full "+963..." the
      // backend matches on, same helper the validator below uses so the two
      // can never drift apart.
      phone: phoneTextFieldFullValue(_phoneController.text),
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
                  const Center(child: BrandLogo(width: 150)),
                  const SizedBox(height: AppSizes.spacingLarge),
                  Text(
                    l10n.passwordLoginSubtitle,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingLarge),
                  PhoneTextField(
                    label: l10n.phoneLabel,
                    controller: _phoneController,
                    validator: (value) => Validators.validatePhone(
                      phoneTextFieldFullValue(value ?? ''),
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
