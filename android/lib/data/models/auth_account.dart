/// نموذج الحساب المخزن محلياً لدعم تبديل الحسابات (Multi-Account Switcher — R-35)
class AuthAccount {
  final String id; // storeOwnerId أو userId
  final String phone;
  final String displayName;
  final String storeName;
  final String role; // 'STORE_OWNER' | 'WORKER'
  final bool isResponsibleWorker;
  final bool allowResponsiblePurchases;
  final String accessToken;
  final String refreshToken;
  final DateTime lastActiveAt;
  final Map<String, dynamic> permissions;

  AuthAccount({
    required this.id,
    required this.phone,
    required this.displayName,
    required this.storeName,
    required this.role,
    this.isResponsibleWorker = false,
    this.allowResponsiblePurchases = false,
    required this.accessToken,
    required this.refreshToken,
    required this.lastActiveAt,
    this.permissions = const {},
  });

  bool get isOwner => role == 'STORE_OWNER';

  Map<String, dynamic> toJson() => {
        'id': id,
        'phone': phone,
        'displayName': displayName,
        'storeName': storeName,
        'role': role,
        'isResponsibleWorker': isResponsibleWorker,
        'allowResponsiblePurchases': allowResponsiblePurchases,
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'lastActiveAt': lastActiveAt.toIso8601String(),
        'permissions': permissions,
      };

  factory AuthAccount.fromJson(Map<String, dynamic> json) => AuthAccount(
        id: json['id'],
        phone: json['phone'],
        displayName: json['displayName'] ?? '',
        storeName: json['storeName'] ?? '',
        role: json['role'] ?? 'WORKER',
        isResponsibleWorker: json['isResponsibleWorker'] ?? false,
        allowResponsiblePurchases: json['allowResponsiblePurchases'] == true,
        accessToken: json['accessToken'],
        refreshToken: json['refreshToken'],
        lastActiveAt: DateTime.parse(json['lastActiveAt']),
        permissions: Map<String, dynamic>.from(json['permissions'] ?? {}),
      );

  AuthAccount copyWith({
    String? accessToken,
    String? refreshToken,
    DateTime? lastActiveAt,
    Map<String, dynamic>? permissions,
    bool? allowResponsiblePurchases,
  }) {
    return AuthAccount(
      id: id,
      phone: phone,
      displayName: displayName,
      storeName: storeName,
      role: role,
      isResponsibleWorker: isResponsibleWorker,
      allowResponsiblePurchases:
          allowResponsiblePurchases ?? this.allowResponsiblePurchases,
      accessToken: accessToken ?? this.accessToken,
      refreshToken: refreshToken ?? this.refreshToken,
      lastActiveAt: lastActiveAt ?? this.lastActiveAt,
      permissions: permissions ?? this.permissions,
    );
  }
}
