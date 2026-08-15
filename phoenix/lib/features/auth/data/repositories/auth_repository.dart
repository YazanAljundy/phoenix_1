import 'package:image_picker/image_picker.dart';
import 'package:phoenix/features/auth/data/models/auth_response.dart';
import 'package:phoenix/features/auth/data/models/me_response.dart';

abstract class AuthRepository {
  Future<void> sendOtp(String phone);

  Future<AuthResponse> register({
    required String name,
    required String pharmacyName,
    required String phone,
    required String address,
    required String otpCode,
    required String password,
    required XFile verificationPhoto,
  });

  // Section 6-2: phone + password, no OTP - the returning-user alternative to
  // register() offered from the same registration screen.
  Future<AuthResponse> loginWithPassword({required String phone, required String password});

  Future<MeResponse> getMe();
}
