import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/validators.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/phone_text_field.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
import 'package:phoenix/features/auth/presentation/widgets/location_map_field.dart';
import 'package:phoenix/routes/route_names.dart';

class RegistrationView extends StatefulWidget {
  const RegistrationView({super.key});

  @override
  State<RegistrationView> createState() => _RegistrationViewState();
}

class _RegistrationViewState extends State<RegistrationView> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _pharmacyNameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _agreedToTerms = false;
  String? _termsError;
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  double? _latitude;
  double? _longitude;
  // Section 6.2 update: there's no manual address field anymore - this is
  // the map's own reverse-geocoded text, and it's what gets submitted as
  // `address` below.
  String? _resolvedAddress;
  String? _addressError;

  @override
  void dispose() {
    _nameController.dispose();
    _pharmacyNameController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _handleLocationChanged(double latitude, double longitude, String? address) {
    setState(() {
      _latitude = latitude;
      _longitude = longitude;
      _resolvedAddress = address;
      if (address != null && address.isNotEmpty) _addressError = null;
    });
  }

  // Section 6-2/3: registers and routes directly by the resulting
  // sessionStatus - no OTP hop (temporarily disabled, see AuthCubit.register).
  Future<void> _submit() async {
    context.unfocus();
    final l10n = context.l10n;
    final formValid = _formKey.currentState!.validate();
    final address = _resolvedAddress?.trim() ?? '';
    setState(() {
      _termsError = _agreedToTerms ? null : l10n.termsAgreementRequiredError;
      _addressError = address.isEmpty ? l10n.addressNotResolvedYetMessage : null;
    });
    if (!formValid || !_agreedToTerms || address.isEmpty) return;

    final cubit = context.read<AuthCubit>();
    final registered = await cubit.register(
      name: _nameController.text.trim(),
      pharmacyName: _pharmacyNameController.text.trim(),
      // The field only ever holds local digits (see PhoneTextField) - this
      // is the one place that composes the full "+963..." value the backend
      // expects, same helper the validator below uses, so the two can never
      // drift apart.
      phone: phoneTextFieldFullValue(_phoneController.text),
      address: address,
      password: _passwordController.text,
      latitude: _latitude,
      longitude: _longitude,
    );
    if (!registered || !mounted) return;

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

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.navyOf(context),
        foregroundColor: Colors.white,
        title: Text(l10n.registrationTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
      body: BlocListener<AuthCubit, AuthState>(
        listenWhen: (previous, current) =>
            current.errorMessage != null &&
            previous.errorMessage != current.errorMessage,
        listener: (context, state) {
          AppSnackbar.show(context, state.errorMessage!);
        },
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              return SingleChildScrollView(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 560),
                    child: Padding(
                      padding: AppPadding.screen,
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _Header(subtitle: l10n.registrationSubtitle),
                            const SizedBox(height: AppSizes.spacingXLarge),
                            AppTextField(
                              label: l10n.fullNameLabel,
                              hint: l10n.fullNameHint,
                              controller: _nameController,
                              keyboardType: TextInputType.name,
                              validator: (value) =>
                                  Validators.validateRequired(value, l10n.fieldRequired),
                            ),
                            const SizedBox(height: AppSizes.spacingMedium),
                            AppTextField(
                              label: l10n.pharmacyNameLabel,
                              hint: l10n.pharmacyNameHint,
                              controller: _pharmacyNameController,
                              keyboardType: TextInputType.text,
                              validator: (value) =>
                                  Validators.validateRequired(value, l10n.fieldRequired),
                            ),
                            const SizedBox(height: AppSizes.spacingMedium),
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
                            LocationMapField(
                              label: l10n.addressLabel,
                              onChanged: _handleLocationChanged,
                            ),
                            if (_addressError != null) ...[
                              const SizedBox(height: AppSizes.spacingXSmall),
                              Text(
                                _addressError!,
                                style: context.textTheme.bodySmall?.copyWith(
                                  color: AppColors.errorOf(context),
                                ),
                              ),
                            ],
                            const SizedBox(height: AppSizes.spacingMedium),
                            AppTextField(
                              label: l10n.password,
                              hint: l10n.passwordHint(Validators.minPasswordLength.toString()),
                              controller: _passwordController,
                              obscureText: _obscurePassword,
                              suffixIcon: _PasswordVisibilityToggle(
                                obscured: _obscurePassword,
                                onToggle: () => setState(() => _obscurePassword = !_obscurePassword),
                              ),
                              validator: (value) => Validators.validateNewPassword(
                                value,
                                requiredMessage: l10n.fieldRequired,
                                tooShortMessage: l10n.passwordTooShort,
                              ),
                            ),
                            const SizedBox(height: AppSizes.spacingMedium),
                            AppTextField(
                              label: l10n.confirmPasswordLabel,
                              hint: l10n.confirmPasswordHint,
                              controller: _confirmPasswordController,
                              obscureText: _obscureConfirmPassword,
                              suffixIcon: _PasswordVisibilityToggle(
                                obscured: _obscureConfirmPassword,
                                onToggle: () =>
                                    setState(() => _obscureConfirmPassword = !_obscureConfirmPassword),
                              ),
                              validator: (value) => Validators.validateConfirmPassword(
                                value,
                                _passwordController.text,
                                requiredMessage: l10n.fieldRequired,
                                mismatchMessage: l10n.passwordMismatch,
                              ),
                            ),
                            const SizedBox(height: AppSizes.spacingXSmall),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(
                                  Icons.info_outline,
                                  size: AppSizes.iconSizeSmall,
                                  color: AppColors.textSecondaryOf(context),
                                ),
                                const SizedBox(width: AppSizes.spacingXSmall),
                                Expanded(
                                  child: Text(
                                    l10n.passwordsMustMatchHint,
                                    style: context.textTheme.bodySmall?.copyWith(
                                      color: AppColors.textSecondaryOf(context),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: AppSizes.spacingMedium),
                            _TermsCheckbox(
                              agreed: _agreedToTerms,
                              error: _termsError,
                              onToggle: () => setState(() {
                                _agreedToTerms = !_agreedToTerms;
                                if (_agreedToTerms) _termsError = null;
                              }),
                            ),
                            const SizedBox(height: AppSizes.spacingXLarge),
                            BlocBuilder<AuthCubit, AuthState>(
                              buildWhen: (previous, current) =>
                                  previous.isSubmitting != current.isSubmitting,
                              builder: (context, state) => PrimaryButton(
                                label: l10n.createAccountButton,
                                isLoading: state.isSubmitting,
                                onPressed: _submit,
                              ),
                            ),
                            const SizedBox(height: AppSizes.spacingMedium),
                            Center(
                              child: TextButton(
                                onPressed: () => context.pushNamed(RouteNames.login),
                                child: Text(l10n.alreadyHaveAccountLink),
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
  const _Header({required this.subtitle});

  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(color: AppColors.navyOf(context), borderRadius: AppRadius.large),
          child: const Icon(Icons.local_pharmacy_rounded, color: Colors.white, size: 30),
        ),
        const SizedBox(height: AppSizes.spacingMedium),
        Text(l10n.registrationTitle, style: context.textTheme.displaySmall),
        const SizedBox(height: AppSizes.spacingXSmall),
        Text(
          subtitle,
          style: context.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondaryOf(context)),
        ),
      ],
    );
  }
}

class _PasswordVisibilityToggle extends StatelessWidget {
  const _PasswordVisibilityToggle({required this.obscured, required this.onToggle});

  final bool obscured;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onToggle,
      icon: Icon(
        obscured ? Icons.visibility_outlined : Icons.visibility_off_outlined,
        color: AppColors.textSecondaryOf(context),
      ),
    );
  }
}

class _TermsCheckbox extends StatelessWidget {
  const _TermsCheckbox({required this.agreed, required this.error, required this.onToggle});

  final bool agreed;
  final String? error;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final color = error != null ? AppColors.errorOf(context) : AppColors.borderOf(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: onToggle,
          borderRadius: AppRadius.small,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSizes.spacingXSmall),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 22,
                  height: 22,
                  margin: const EdgeInsets.only(top: 1),
                  decoration: BoxDecoration(
                    borderRadius: AppRadius.small,
                    border: Border.all(color: agreed ? AppColors.primaryOf(context) : color, width: 1.5),
                    color: agreed ? AppColors.primaryOf(context) : Colors.transparent,
                  ),
                  child: agreed
                      ? const Icon(Icons.check, color: Colors.white, size: 16)
                      : null,
                ),
                const SizedBox(width: AppSizes.spacingSmall),
                Expanded(
                  child: Text(
                    l10n.termsAgreementLabel,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(error!, style: context.textTheme.bodySmall?.copyWith(color: AppColors.errorOf(context))),
          ),
      ],
    );
  }
}
