import '../constants/app_strings.dart';
import '../extensions/string_extensions.dart';

class Validators {
  const Validators._();

  static String? validateEmail(String? value) {
    if (value == null || value.trim().isEmpty) {
      return AppStrings.emailRequired;
    }
    if (!value.isValidEmail) {
      return AppStrings.invalidEmail;
    }
    return null;
  }

  static String? validatePassword(String? value) {
    if (value == null || value.trim().isEmpty) {
      return AppStrings.passwordRequired;
    }
    if (!value.isValidPassword) {
      return AppStrings.invalidPassword;
    }
    return null;
  }

  static final RegExp _syrianPhoneRegExp = RegExp(r'^(?:\+963|0)9\d{8}$');

  static String? validatePhone(String? value, {required String requiredMessage, required String invalidMessage}) {
    final trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return requiredMessage;
    if (!_syrianPhoneRegExp.hasMatch(trimmed.replaceAll(RegExp(r'[\s-]'), ''))) {
      return invalidMessage;
    }
    return null;
  }

  static String? validateRequired(String? value, String requiredMessage) {
    if (value == null || value.trim().isEmpty) return requiredMessage;
    return null;
  }

  static String? validateOtpCode(String? value, {required String requiredMessage, required String invalidMessage}) {
    final trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return requiredMessage;
    if (!RegExp(r'^\d{6}$').hasMatch(trimmed)) return invalidMessage;
    return null;
  }

  static const int minPasswordLength = 6;

  static String? validateNewPassword(
    String? value, {
    required String requiredMessage,
    required String tooShortMessage,
  }) {
    if (value == null || value.isEmpty) return requiredMessage;
    if (value.length < minPasswordLength) return tooShortMessage;
    return null;
  }

  static String? validateConfirmPassword(
    String? value,
    String password, {
    required String requiredMessage,
    required String mismatchMessage,
  }) {
    if (value == null || value.isEmpty) return requiredMessage;
    if (value != password) return mismatchMessage;
    return null;
  }
}
