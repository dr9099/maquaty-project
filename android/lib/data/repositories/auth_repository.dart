import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage_service.dart';
import '../models/auth_account.dart';

class AuthRepository {
  final ApiClient _api;
  final SecureStorageService _storage = SecureStorageService();

  AuthRepository(this._api);

  Future<AuthAccount> login({
    required String phone,
    required String password,
  }) async {
    final res = await _api.post(
      ApiEndpoints.login,
      data: {
        'phone': phone,
        'password': password,
      },
    );

    final data = res.data;
    final user = data['user'] ?? {};

    final account = AuthAccount(
      id: user['storeOwnerId'] ?? user['id'],
      phone: phone,
      displayName: user['name'] ?? '',
      storeName: user['storeName'] ?? 'متجر مَقوتي',
      role: user['role'] ?? 'WORKER',
      isResponsibleWorker: user['isResponsibleWorker'] ?? false,
      accessToken: data['accessToken'],
      refreshToken: data['refreshToken'],
      lastActiveAt: DateTime.now(),
      permissions: user['permissions'] != null
          ? Map<String, dynamic>.from(user['permissions'])
          : {},
    );

    await _storage.saveAccount(account, setActive: true);
    return account;
  }

  Future<AuthAccount> registerOwner({
    required String name,
    required String storeName,
    required String phone,
    required String password,
  }) async {
    final res = await _api.post(
      ApiEndpoints.registerOwner,
      data: {
        'name': name,
        'storeName': storeName,
        'phone': phone,
        'password': password,
      },
    );

    final data = res.data;
    final user = data['user'] ?? {};

    final account = AuthAccount(
      id: user['storeOwnerId'] ?? user['id'],
      phone: phone,
      displayName: name,
      storeName: storeName,
      role: 'STORE_OWNER',
      isResponsibleWorker: false,
      accessToken: data['accessToken'],
      refreshToken: data['refreshToken'],
      lastActiveAt: DateTime.now(),
      permissions: {},
    );

    await _storage.saveAccount(account, setActive: true);
    return account;
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
