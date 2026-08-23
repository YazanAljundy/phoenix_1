// Carries the registration form's field values from RegistrationView to
// OtpVerificationView (passed as the go_router `extra`), so the whole form is
// submitted together with the OTP code in a single /auth/register call.
class RegistrationDraft {
  const RegistrationDraft({
    required this.name,
    required this.pharmacyName,
    required this.phone,
    required this.address,
    required this.password,
  });

  final String name;
  final String pharmacyName;
  final String phone;
  final String address;
  final String password;
}
