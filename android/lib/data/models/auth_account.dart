/// نموذج الحساب المخزن محلياً لدعم تبديل الحسابات (Multi-Account Switcher — R-35)
class AuthAccount {
  final String id; // storeOwnerId أو userId
  final String phone;
  final String displayName;
  final String storeName;
  final String role; // 'STORE_OWNER' | 'WORKER'
  final String accountStatus; // 'TRIAL' | 'TRIAL_WARNING' | 'ACTIVE' | 'TRIAL_EXPIRED' | 'EXPIRED' | 'SUSPENDED'
  final bool isResponsibleWorker;
  final bool allowResponsiblePurchases;
  final int trialSalesUsed;
  final int trialSalesLimit;
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
    this.accountStatus = 'TRIAL',
    this.isResponsibleWorker = false,
    this.allowResponsiblePurchases = false,
    this.trialSalesUsed = 0,
    this.trialSalesLimit = 50,
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
        'accountStatus': accountStatus,
        'isResponsibleWorker': isResponsibleWorker,
        'allowResponsiblePurchases': allowResponsiblePurchases,
        'trialSalesUsed': trialSalesUsed,
        'trialSalesLimit': trialSalesLimit,
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'lastActiveAt': lastActiveAt.toIso8601String(),
        'permissions': permissions,
      };

  factory AuthAccount.fromJson(Map<String, dynamic> json) => AuthAccount(
        id: json['id'],
        phone: json['phone'],
        displayName: (json['displayName'] ??
                json['display_name'] ??
                json['fullName'] ??
                json['full_name'] ??
                '')
            .toString(),
        storeName: (json['storeName'] ?? json['store_name'] ?? '').toString(),
        role: json['role'] ?? 'WORKER',
        accountStatus: json['accountStatus'] ?? json['account_status'] ?? 'TRIAL',
        isResponsibleWorker: (json['isResponsibleWorker'] ?? json['is_responsible']) == true,
        allowResponsiblePurchases: json['allowResponsiblePurchases'] == true ||
            json['allow_responsible_purchases'] == true,
        trialSalesUsed:
            ((json['trialSalesUsed'] ?? json['trial_sales_used']) as num?)
                    ?.toInt() ??
                0,
        trialSalesLimit:
            ((json['trialSalesLimit'] ?? json['trial_sales_limit']) as num?)
                    ?.toInt() ??
                50,
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
    String? accountStatus,
    int? trialSalesUsed,
    int? trialSalesLimit,
  }) {
    return AuthAccount(
      id: id,
      phone: phone,
      displayName: displayName,
      storeName: storeName,
      role: role,
      accountStatus: accountStatus ?? this.accountStatus,
      isResponsibleWorker: isResponsibleWorker,
      allowResponsiblePurchases:
          allowResponsiblePurchases ?? this.allowResponsiblePurchases,
      trialSalesUsed: trialSalesUsed ?? this.trialSalesUsed,
      trialSalesLimit: trialSalesLimit ?? this.trialSalesLimit,
      accessToken: accessToken ?? this.accessToken,
      refreshToken: refreshToken ?? this.refreshToken,
      lastActiveAt: lastActiveAt ?? this.lastActiveAt,
      permissions: permissions ?? this.permissions,
    );
  }
}
