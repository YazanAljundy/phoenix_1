import 'package:phoenix/features/auth/data/models/pharmacy_model.dart';
import 'package:phoenix/features/auth/data/models/user_model.dart';

class MeResponse {
  const MeResponse({required this.user, this.pharmacy});

  final UserModel user;
  final PharmacyModel? pharmacy;

  factory MeResponse.fromJson(Map<String, dynamic> json) => MeResponse(
    user: UserModel.fromJson(json['user'] as Map<String, dynamic>),
    pharmacy: json['pharmacy'] != null
        ? PharmacyModel.fromJson(json['pharmacy'] as Map<String, dynamic>)
        : null,
  );
}
