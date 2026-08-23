import 'package:phoenix/features/auth/data/models/auth_response.dart';
import 'package:phoenix/features/auth/data/models/me_response.dart';

abstract class AuthRepository {
  // TODO(re-enable-otp): unused by the current flow - kept for a future
  // re-enable (see AuthCubit.register). The backend route is still live.
  Future<void> sendOtp(String phone);

  // Section 6-2/3: registers and saves the account directly - OTP is
  // temporarily disabled (project owner's decision). Admin's manual approval
  // is the verification step for now instead of a confirmed phone number.
  //
  // Section 6.2 update: no longer collects a verification photo here - that
  // moves to a separate post-approval step. `latitude`/`longitude` are from
  // the registration screen's optional map picker; either both are present
  // or both are null, never just one.
  Future<AuthResponse> register({
    required String name,
    required String pharmacyName,
    required String phone,
    required String address,
    required String password,
    double? latitude,
    double? longitude,
  });

  // Section 6-2: phone + password, no OTP - the returning-user alternative to
  // register() offered from the same registration screen.
  Future<AuthResponse> loginWithPassword({required String phone, required String password});

  Future<MeResponse> getMe();

  // Registers this device's FCM token against the signed-in user - best-
  // effort from the caller's side (FcmService swallows failures itself),
  // but the repository call itself stays a plain throw-on-failure like
  // every other endpoint here.
  Future<void> registerDeviceToken({required String fcmToken, required String deviceType});
}
