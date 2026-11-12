import 'package:dio/dio.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../core/services/device_info_service.dart';
import '../../core/storage/secure_storage_service.dart';
import '../models/auth_account.dart';

class AuthRepository {
  final ApiClient _api;
  final SecureStorageService _storage = SecureStorageService();
  String? _tempAccessToken;
  String? _pendingPhone;

  AuthRepository(this._api);

  String? get tempAccessToken => _tempAccessToken;

  Future<AuthAccount> login({
    required String phone,
    required String password,
    String? deviceFingerprint,
  }) async {
    final fingerprint =
        deviceFingerprint ?? await DeviceInfoService.getDeviceFingerprint();
    final res = await _api.post(
      ApiEndpoints.login,
      data: {
        'phone': phone,
        'password': password,
        'deviceFingerprint': fingerprint,
      },
    );

    final data = res.data;
    if (data is Map && data['must_change_password'] == true) {
      _tempAccessToken = (data['temp_access_token'] ?? '').toString();
      _pendingPhone = phone;
      return AuthAccount(
        id: (data['user_id'] ?? '').toString(),
        phone: phone,
        displayName: '',
        storeName: 'متجر مَقوتي',
        role: (data['role'] ?? 'STORE_OWNER').toString(),
        accountStatus: 'MUST_CHANGE_PASSWORD',
        isResponsibleWorker: false,
        allowResponsiblePurchases: false,
        accessToken: _tempAccessToken ?? '',
        refreshToken: '',
        lastActiveAt: DateTime.now(),
        permissions: const {},
      );
    }

    final user = data['user'] ?? {};

    final account = AuthAccount(
      id: (user['id'] ?? user['storeOwnerId'] ?? data['user_id'] ?? '').toString(),
      phone: phone,
      displayName: (user['name'] ?? '').toString(),
      storeName: (user['storeName'] ?? 'متجر مَقوتي').toString(),
      role: (user['role'] ?? data['role'] ?? 'WORKER').toString(),
      accountStatus: (user['accountStatus'] ?? data['account_status'] ?? 'TRIAL').toString(),
      isResponsibleWorker: user['isResponsibleWorker'] == true ||
          data['is_responsible'] == true,
      allowResponsiblePurchases: user['allowResponsiblePurchases'] == true ||
          data['allow_responsible_purchases'] == true,
      trialSalesUsed:
          ((user['trialSalesUsed'] ?? data['trial_sales_used']) as num?)
                  ?.toInt() ??
              0,
      trialSalesLimit:
          ((user['trialSalesLimit'] ?? data['trial_sales_limit']) as num?)
                  ?.toInt() ??
              50,
      accessToken: (data['access_token'] ?? data['accessToken'] ?? '').toString(),
      refreshToken:
          (data['refresh_token'] ?? data['refreshToken'] ?? '').toString(),
      lastActiveAt: DateTime.now(),
      permissions: user['permissions'] != null
          ? Map<String, dynamic>.from(user['permissions'])
          : {},
    );

    await _storage.saveAccount(account, setActive: true);
    return account;
  }

  Future<AuthAccount> registerOwner({
    required String fullName,
    required String storeName,
    required String phone,
    required String password,
    required String passwordConfirmation,
    String? deviceFingerprint,
  }) async {
    final fingerprint =
        deviceFingerprint ?? await DeviceInfoService.getDeviceFingerprint();
    final res = await _api.post(
      ApiEndpoints.registerOwner,
      data: {
        'fullName': fullName,
        'storeName': storeName,
        'phone': phone,
        'password': password,
        'passwordConfirmation': passwordConfirmation,
        'deviceFingerprint': fingerprint,
      },
    );

    final data = res.data;
    final user = data['user'] ?? {};
    final accountData = data['account'] ?? {};

    final ownerId = (user['storeOwnerId'] ??
            user['id'] ??
            accountData['id'] ??
            data['store_owner_id'] ??
            '')
        .toString();

    final account = AuthAccount(
      id: ownerId,
      phone: phone,
      displayName: (user['name'] ?? accountData['full_name'] ?? fullName).toString(),
      storeName: (user['storeName'] ?? accountData['store_name'] ?? storeName).toString(),
      role: 'STORE_OWNER',
      accountStatus: (accountData['status'] ??
              user['accountStatus'] ??
              data['account_status'] ??
              'TRIAL')
          .toString(),
      isResponsibleWorker: false,
      allowResponsiblePurchases: user['allowResponsiblePurchases'] == true ||
          accountData['allow_responsible_purchases'] == true,
      trialSalesUsed:
          ((user['trialSalesUsed'] ?? accountData['trial_sales_used']) as num?)
                  ?.toInt() ??
              0,
      trialSalesLimit:
          ((user['trialSalesLimit'] ?? accountData['trial_sales_limit']) as num?)
                  ?.toInt() ??
              50,
      accessToken: (data['access_token'] ?? data['accessToken'] ?? '').toString(),
      refreshToken:
          (data['refresh_token'] ?? data['refreshToken'] ?? '').toString(),
      lastActiveAt: DateTime.now(),
      permissions: {},
    );

    await _storage.saveAccount(account, setActive: true);
    return account;
  }

  Future<void> saveUpdatedAccount(AuthAccount account) async {
    await _storage.saveAccount(account, setActive: true);
  }

  Future<AuthAccount> changeTempPassword({
    String? currentPassword,
    required String newPassword,
    String? newPasswordConfirmation,
    String? tempAccessToken,
  }) async {
    final token = tempAccessToken ?? _tempAccessToken;
    final res = await _api.post(
      ApiEndpoints.changeTempPassword,
      data: {
        'newPassword': newPassword,
        'newPasswordConfirmation': newPasswordConfirmation ?? newPassword,
      },
      options: (token != null && token.isNotEmpty)
          ? Options(headers: {'Authorization': 'Bearer $token'})
          : null,
    );

    final data = res.data is Map ? res.data as Map : {};
    final user = data['user'] is Map ? data['user'] as Map : {};

    final account = AuthAccount(
      id: (user['id'] ?? user['storeOwnerId'] ?? data['user_id'] ?? '').toString(),
      phone: (user['phone'] ?? _pendingPhone ?? '').toString(),
      displayName: (user['name'] ?? '').toString(),
      storeName: (user['storeName'] ?? 'متجر مَقوتي').toString(),
      role: (user['role'] ?? data['role'] ?? 'STORE_OWNER').toString(),
      accountStatus: (user['accountStatus'] ??
              user['status'] ??
              data['account_status'] ??
              'TRIAL')
          .toString(),
      isResponsibleWorker: user['isResponsibleWorker'] == true ||
          data['is_responsible'] == true,
      allowResponsiblePurchases: user['allowResponsiblePurchases'] == true ||
          data['allow_responsible_purchases'] == true,
      trialSalesUsed:
          ((user['trialSalesUsed'] ?? data['trial_sales_used']) as num?)
                  ?.toInt() ??
              0,
      trialSalesLimit:
          ((user['trialSalesLimit'] ?? data['trial_sales_limit']) as num?)
                  ?.toInt() ??
              50,
      accessToken: (data['access_token'] ?? data['accessToken'] ?? '').toString(),
      refreshToken:
          (data['refresh_token'] ?? data['refreshToken'] ?? '').toString(),
      lastActiveAt: DateTime.now(),
      permissions: user['permissions'] != null
          ? Map<String, dynamic>.from(user['permissions'])
          : {},
    );

    _tempAccessToken = null;
    _pendingPhone = null;
    if (account.accessToken.isNotEmpty) {
      await _storage.saveAccount(account, setActive: true);
    }
    return account;
  }

  Future<void> logout() async {
    final activeAccount = await _storage.getActiveAccount();
    final refreshToken = activeAccount?.refreshToken;
    try {
      await _api.post(
        ApiEndpoints.logout,
        data: {
          if (refreshToken != null && refreshToken.isNotEmpty)
            'refreshToken': refreshToken,
        },
      );
    } catch (_) {
      // تجاهل أخطاء الشبكة أثناء تسجيل الخروج لضمان تنظيف التخزين المحلي
    } finally {
      final activeId = activeAccount?.id ?? await _storage.getActiveAccountId();
      if (activeId != null) {
        await _storage.removeAccount(activeId);
      }
    }
  }

  Future<AuthAccount?> getCurrentAccount() => _storage.getActiveAccount();
  Future<List<AuthAccount>> getAllAccounts() => _storage.getAccounts();
  Future<void> switchAccount(String id) => _storage.setActiveAccount(id);
}
