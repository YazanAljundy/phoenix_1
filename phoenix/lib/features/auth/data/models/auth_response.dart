import 'package:phoenix/features/auth/data/models/pharmacy_model.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';

class AuthResponse {
  const AuthResponse({required this.token, required this.user, this.pharmacy});

  final String token;
  final UserModel user;
  final PharmacyModel? pharmacy;

  factory AuthResponse.fromJson(Map<String, dynamic> json) => AuthResponse(
    token: json['token'] as String,
    user: UserModel.fromJson(json['user'] as Map<String, dynamic>),
    pharmacy: json['pharmacy'] != null
        ? PharmacyModel.fromJson(json['pharmacy'] as Map<String, dynamic>)
        : null,
  );
}
