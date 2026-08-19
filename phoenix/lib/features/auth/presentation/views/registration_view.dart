import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:phoenix/core/constants/app_colors.dart';
import 'package:phoenix/core/constants/app_padding.dart';
import 'package:phoenix/core/constants/app_radius.dart';
import 'package:phoenix/core/constants/app_sizes.dart';
import 'package:phoenix/core/extensions/build_context_extensions.dart';
import 'package:phoenix/core/utils/validators.dart';
import 'package:phoenix/core/widgets/app_snackbar.dart';
import 'package:phoenix/core/widgets/app_text_field.dart';
import 'package:phoenix/core/widgets/primary_button.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_cubit.dart';
import 'package:phoenix/features/auth/presentation/managers/auth_state.dart';
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
  final _addressController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  XFile? _verificationPhoto;
  Uint8List? _photoPreviewBytes;
  String? _photoError;

  @override
  void dispose() {
    _nameController.dispose();
    _pharmacyNameController.dispose();
    _phoneController.dispose();
    _addressController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null || !mounted) return;
    final bytes = await picked.readAsBytes();
    if (!mounted) return;
    setState(() {
      _verificationPhoto = picked;
      _photoPreviewBytes = bytes;
      _photoError = null;
    });
  }

  // Section 6-2/3: registers and routes directly by the resulting
  // sessionStatus - no OTP hop (temporarily disabled, see AuthCubit.register).
  Future<void> _submit() async {
    context.unfocus();
    final l10n = context.l10n;
    final formValid = _formKey.currentState!.validate();
    setState(() {
      _photoError = _verificationPhoto == null ? l10n.photoRequired : null;
    });
    if (!formValid || _verificationPhoto == null) return;

    final cubit = context.read<AuthCubit>();
    final registered = await cubit.register(
      name: _nameController.text.trim(),
      pharmacyName: _pharmacyNameController.text.trim(),
      phone: _phoneController.text.trim(),
      address: _addressController.text.trim(),
      password: _passwordController.text,
      verificationPhoto: _verificationPhoto!,
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
        title: Text(l10n.registrationTitle),
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
                    l10n.registrationSubtitle,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondaryOf(context),
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingLarge),
                  AppTextField(
                    label: l10n.fullNameLabel,
                    controller: _nameController,
                    keyboardType: TextInputType.name,
                    validator: (value) =>
                        Validators.validateRequired(value, l10n.fieldRequired),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  AppTextField(
                    label: l10n.pharmacyNameLabel,
                    controller: _pharmacyNameController,
                    keyboardType: TextInputType.text,
                    validator: (value) =>
                        Validators.validateRequired(value, l10n.fieldRequired),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  AppTextField(
                    label: l10n.phoneLabel,
                    controller: _phoneController,
                    keyboardType: TextInputType.phone,
                    validator: (value) => Validators.validatePhone(
                      value,
                      requiredMessage: l10n.fieldRequired,
                      invalidMessage: l10n.invalidPhoneNumber,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  AppTextField(
                    label: l10n.addressLabel,
                    controller: _addressController,
                    keyboardType: TextInputType.streetAddress,
                    validator: (value) =>
                        Validators.validateRequired(value, l10n.fieldRequired),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  Text(l10n.verificationPhotoLabel, style: context.textTheme.bodyMedium),
                  const SizedBox(height: AppSizes.spacingSmall),
                  InkWell(
                    onTap: _pickPhoto,
                    borderRadius: AppRadius.medium,
                    child: Container(
                      height: 120,
                      decoration: BoxDecoration(
                        borderRadius: AppRadius.medium,
                        border: Border.all(
                          color: _photoError != null
                              ? Theme.of(context).colorScheme.error
                              : AppColors.borderOf(context),
                        ),
                        image: _photoPreviewBytes != null
                            ? DecorationImage(
                                image: MemoryImage(_photoPreviewBytes!),
                                fit: BoxFit.cover,
                              )
                            : null,
                      ),
                      child: _photoPreviewBytes == null
                          ? Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.add_a_photo_outlined,
                                  color: AppColors.textSecondaryOf(context),
                                ),
                                const SizedBox(height: AppSizes.spacingSmall),
                                Text(
                                  l10n.choosePhotoButton,
                                  style: context.textTheme.bodySmall?.copyWith(
                                    color: AppColors.textSecondaryOf(context),
                                  ),
                                ),
                              ],
                            )
                          : Align(
                              alignment: AlignmentDirectional.bottomEnd,
                              child: Container(
                                margin: const EdgeInsets.all(8),
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.6),
                                  borderRadius: AppRadius.small,
                                ),
                                child: Text(
                                  l10n.changePhotoButton,
                                  style: context.textTheme.bodySmall?.copyWith(color: Colors.white),
                                ),
                              ),
                            ),
                    ),
                  ),
                  if (_photoError != null) ...[
                    const SizedBox(height: AppSizes.spacingXSmall),
                    Text(
                      _photoError!,
                      style: context.textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSizes.spacingMedium),
                  Text(l10n.verificationPhotoHint, style: context.textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondaryOf(context),
                  )),
                  const SizedBox(height: AppSizes.spacingMedium),
                  AppTextField(
                    label: l10n.password,
                    controller: _passwordController,
                    obscureText: true,
                    validator: (value) => Validators.validateNewPassword(
                      value,
                      requiredMessage: l10n.fieldRequired,
                      tooShortMessage: l10n.passwordTooShort,
                    ),
                  ),
                  const SizedBox(height: AppSizes.spacingMedium),
                  AppTextField(
                    label: l10n.confirmPasswordLabel,
                    controller: _confirmPasswordController,
                    obscureText: true,
                    validator: (value) => Validators.validateConfirmPassword(
                      value,
                      _passwordController.text,
                      requiredMessage: l10n.fieldRequired,
                      mismatchMessage: l10n.passwordMismatch,
                    ),
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
  }
}
