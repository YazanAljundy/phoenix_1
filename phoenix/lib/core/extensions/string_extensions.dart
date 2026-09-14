import '../constants/password_policy.dart';

extension StringExtensions on String {
  bool get isValidEmail {
    final RegExp regex = RegExp(
      r'^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$',
    );
    return regex.hasMatch(this);
  }

  // Length only, and the length comes from constants/password_policy.dart -
  // this used to hardcode its own 6 independently of Validators, so raising
  // one left the other behind.
  bool get isValidPassword => trim().length >= kMinPasswordLength;
}
