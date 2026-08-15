class UserModel {
  const UserModel({
    required this.id,
    required this.name,
    required this.phone,
    required this.role,
    required this.status,
    required this.lang,
  });

  final String id;
  final String name;
  final String phone;
  final String role;
  final String status;
  final String lang;

  factory UserModel.fromJson(Map<String, dynamic> json) => UserModel(
    id: json['id'] as String,
    name: json['name'] as String,
    phone: json['phone'] as String,
    role: json['role'] as String,
    status: json['status'] as String,
    lang: json['lang'] as String,
  );

  bool get isPending => status == 'pending';
  bool get isBlocked => status == 'blocked';
  bool get isActive => status == 'active';
}
