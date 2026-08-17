import 'package:image_picker/image_picker.dart';
import 'package:phoenix/features/auth/data/models/auth_response.dart';
import 'package:phoenix/features/auth/data/models/me_response.dart';

abstract class AuthRepository {
  // TODO(re-enable-otp): unused by the current flow - kept for a future
  // re-enable (see AuthCubit.register). The backend route is still live.
  Future<void> sendOtp(String phone);

  // Section 6-2/3: registers and saves the account directly - OTP is
  // temporarily disabled (project owner's decision). Admin's manual approval
  // is the verification step for now instead of a confirmed phone number.
  Future<AuthResponse> register({
    required String name,
    required String pharmacyName,
    required String phone,
    required String address,
    required String password,
    required XFile verificationPhoto,
  });

  // Section 6-2: phone + password, no OTP - the returning-user alternative to
  // register() offered from the same registration screen.
  Future<AuthResponse> loginWithPassword({required String phone, required String password});

  Future<MeResponse> getMe();
}
