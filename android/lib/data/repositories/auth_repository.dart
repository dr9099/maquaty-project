import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../core/services/device_info_service.dart';
import '../../core/storage/secure_storage_service.dart';
import '../models/auth_account.dart';

class AuthRepository {
  final ApiClient _api;
  final SecureStorageService _storage = SecureStorageService();

  AuthRepository(this._api);

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
    final user = data['user'] ?? {};

    final account = AuthAccount(
      id: (user['id'] ?? user['storeOwnerId'] ?? data['user_id'] ?? '').toString(),
      phone: phone,
      displayName: (user['name'] ?? '').toString(),
      storeName: (user['storeName'] ?? 'متجر مَقوتي').toString(),
      role: (user['role'] ?? data['role'] ?? 'WORKER').toString(),
      isResponsibleWorker: user['isResponsibleWorker'] == true ||
          data['is_responsible'] == true,
      allowResponsiblePurchases: user['allowResponsiblePurchases'] == true ||
          data['allow_responsible_purchases'] == true,
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

    final account = AuthAccount(
      id: (user['storeOwnerId'] ??
              user['id'] ??
              accountData['id'] ??
              data['store_owner_id'] ??
              '')
          .toString(),
      phone: phone,
      displayName: fullName,
      storeName: storeName,
      role: 'STORE_OWNER',
      isResponsibleWorker: false,
      allowResponsiblePurchases: false,
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

  Future<void> changeTempPassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _api.post(
      ApiEndpoints.changeTempPassword,
      data: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      },
    );
  }

  Future<void> logout() async {
    try {
      await _api.post(ApiEndpoints.logout);
    } catch (_) {}
    final activeId = await _storage.getActiveAccountId();
    if (activeId != null) {
      await _storage.removeAccount(activeId);
    }
  }

  Future<AuthAccount?> getCurrentAccount() => _storage.getActiveAccount();
  Future<List<AuthAccount>> getAllAccounts() => _storage.getAccounts();
  Future<void> switchAccount(String id) => _storage.setActiveAccount(id);
}
