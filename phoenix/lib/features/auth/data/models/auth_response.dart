import 'package:feniq/features/auth/data/models/pharmacy_model.dart';
import 'package:feniq/features/auth/data/models/user_model.dart';

class AuthResponse {
  const AuthResponse({
    required this.token,
    required this.user,
    this.pharmacy,
    this.refreshToken,
  });

  final String token;
  final UserModel user;
  final PharmacyModel? pharmacy;

  /// Nullable on purpose: a backend that predates F-03 sends no refresh
  /// token, and the app must still log in against it rather than crashing
  /// on a missing key.
  final String? refreshToken;

  factory AuthResponse.fromJson(Map<String, dynamic> json) => AuthResponse(
    token: json['token'] as String,
    refreshToken: json['refreshToken'] as String?,
    user: UserModel.fromJson(json['user'] as Map<String, dynamic>),
    pharmacy: json['pharmacy'] != null
        ? PharmacyModel.fromJson(json['pharmacy'] as Map<String, dynamic>)
        : null,
  );
}
