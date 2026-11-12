import 'package:flutter/foundation.dart';
import '../../core/network/api_client.dart';
import '../../core/utils/error_formatter.dart';
import '../../data/models/auth_account.dart';
import '../../data/repositories/auth_repository.dart';

enum AuthStatus {
  initial,
  authenticated,
  unauthenticated,
  mustChangePassword,
  accountLocked,
}

class AuthProvider with ChangeNotifier {
  final AuthRepository _repo;

  AuthStatus _status = AuthStatus.initial;
  AuthAccount? _currentAccount;
  List<AuthAccount> _accounts = [];
  bool _isLoading = false;
  String? _errorMessage;
  String? _lockReason;
  String _supportPhone = '735717710';
  String? _contactWhatsapp;
  String? _minAppVersionRequired;

  AuthProvider(this._repo);

  AuthStatus get status => _status;
  AuthAccount? get currentAccount => _currentAccount;
  List<AuthAccount> get accounts => _accounts;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get lockReason => _lockReason;
  String get supportPhone => _supportPhone;
  String? get contactWhatsapp => _contactWhatsapp;
  String? get minAppVersionRequired => _minAppVersionRequired;
  bool get isAppUpdateRequired => _minAppVersionRequired != null;
  String? get storeOwnerId => _currentAccount?.id;
  String? get workerId =>
      _currentAccount?.role == 'WORKER' ? _currentAccount?.id : null;

  bool get isAuthenticated => _status == AuthStatus.authenticated && _currentAccount != null;
  bool get isOwner => _currentAccount?.role == 'STORE_OWNER';
  bool get isResponsibleWorker => _currentAccount?.isResponsibleWorker ?? false;
  bool get allowResponsiblePurchases =>
      _currentAccount?.allowResponsiblePurchases ?? false;

  // فحص الصلاحيات الفردية (BR-010 / docs/06-user-roles-permissions.md)
  bool get canViewFunds => isOwner || isResponsibleWorker;
  bool get canManageCredit => isOwner || isResponsibleWorker;
  // النسخ الاحتياطي والاستعادة حصراً للمالك أو العامل المسؤول (R-12 / BR-010 / BR-076)
  bool get canAccessBackup => isOwner || isResponsibleWorker;
  bool get isSubscribed => _currentAccount?.accountStatus == 'ACTIVE';
  // المشتريات والموردون وتكلفة الشراء للمالك افتراضياً، وللعامل المسؤول إذا سمح المالك من الإعدادات (R-38)
  bool get canManagePurchases =>
      isOwner || (isResponsibleWorker && allowResponsiblePurchases);
  bool get canManageSuppliers =>
      isOwner || (isResponsibleWorker && allowResponsiblePurchases);
  bool get canManageStoreSettings => isOwner;

  Future<void> syncAllowResponsiblePurchases(bool allowed) async {
    if (_currentAccount == null) return;
    if (_currentAccount!.allowResponsiblePurchases == allowed) return;
    final updated = _currentAccount!.copyWith(
      allowResponsiblePurchases: allowed,
    );
    _currentAccount = updated;
    try {
      await _repo.saveUpdatedAccount(updated);
      _accounts = await _repo.getAllAccounts();
    } catch (_) {}
    notifyListeners();
  }

  Future<void> updateAccountStatus(String newStatus, {String? contactPhone, String? contactWhatsapp}) async {
    if (_currentAccount == null) return;
    if (contactPhone != null && contactPhone.trim().isNotEmpty) {
      _supportPhone = contactPhone.trim();
    }
    if (contactWhatsapp != null && contactWhatsapp.trim().isNotEmpty) {
      _contactWhatsapp = contactWhatsapp.trim();
    }
    if (newStatus == 'TRIAL_EXPIRED' ||
        newStatus == 'SUBSCRIPTION_EXPIRED' ||
        newStatus == 'EXPIRED' ||
        newStatus == 'SUSPENDED') {
      _status = AuthStatus.accountLocked;
    }
    if (_currentAccount!.accountStatus == newStatus) {
      notifyListeners();
      return;
    }
    final updated = _currentAccount!.copyWith(accountStatus: newStatus);
    _currentAccount = updated;
    try {
      await _repo.saveUpdatedAccount(updated);
      _accounts = await _repo.getAllAccounts();
    } catch (_) {}
    notifyListeners();
  }

  /// قفل التطبيق وإلزام المستخدم بالتحديث عند اكتشاف إصدار أقدم من min_app_version
  void lockForAppUpdate(String minAppVersion) {
    _minAppVersionRequired = minAppVersion;
    _lockReason =
        'إصدار التطبيق الحالي قديم ولم يعد مدعوماً. يرجى تحديث تطبيق مَقوتي إلى الإصدار ($minAppVersion) أو أحدث للمتابعة.';
    _status = AuthStatus.accountLocked;
    notifyListeners();
  }

  @visibleForTesting
  void setCurrentAccountForTesting(AuthAccount? account) {
    _currentAccount = account;
    _status = account != null ? AuthStatus.authenticated : AuthStatus.unauthenticated;
    notifyListeners();
  }
  bool _hasPerm(List<String> keys) {
    final perms = _currentAccount?.permissions;
    if (perms == null) return false;
    for (final k in keys) {
      if (perms[k] == true) return true;
    }
    return false;
  }

  bool get canEnterOwnAdvance {
    if (isOwner) return true;
    if (isResponsibleWorker) {
      return _hasPerm([
        'enterOwnAdvance',
        'enter_own_advance',
        'perm_enter_own_advance',
      ]);
    }
    return false;
  }

  bool get canViewReports {
    if (isOwner) return true;
    return _hasPerm([
      'reportsAccess',
      'reports_access',
      'perm_reports_access',
    ]);
  }

  bool get canRecordDamagedGoods {
    if (isOwner) return true;
    return _hasPerm([
      'damagedGoodsEntry',
      'damaged_goods_entry',
      'perm_damaged_goods_entry',
      'perm_damaged_goods',
    ]);
  }

  bool get canShowCostPrice {
    if (canManagePurchases) return true;
    return _hasPerm([
      'showCostPrice',
      'show_cost_price',
      'perm_show_cost_price',
    ]);
  }

  bool get canShowSellPricesInventory {
    if (isOwner) return true;
    return _hasPerm([
      'showSellPricesInventory',
      'show_sell_prices_inventory',
      'perm_show_sell_prices_inventory',
    ]);
  }

  Future<void> init() async {
    _isLoading = true;
    notifyListeners();

    try {
      _accounts = await _repo.getAllAccounts();
      _currentAccount = await _repo.getCurrentAccount();

      if (_currentAccount != null) {
        _status = AuthStatus.authenticated;
      } else {
        _status = AuthStatus.unauthenticated;
      }
    } catch (_) {
      _status = AuthStatus.unauthenticated;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> login(String phone, String password) async {
    _isLoading = true;
    _errorMessage = null;
    _lockReason = null;
    notifyListeners();

    try {
      final account = await _repo.login(phone: phone, password: password);
      if (account.accountStatus == 'MUST_CHANGE_PASSWORD') {
        _status = AuthStatus.mustChangePassword;
        _isLoading = false;
        notifyListeners();
        return false;
      }
      _currentAccount = account;
      _accounts = await _repo.getAllAccounts();
      _status = AuthStatus.authenticated;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _isLoading = false;
      _errorMessage = formatUserError(e);
      if (e is ApiException &&
          (e.statusCode == 423 ||
              e.code == 'TRIAL_EXPIRED' ||
              e.code == 'SUBSCRIPTION_EXPIRED' ||
              e.code == 'EXPIRED' ||
              e.code == 'STORE_SUSPENDED' ||
              e.code == 'ACCOUNT_LOCKED')) {
        _lockReason = e.message;
        final details = e.details;
        if (details is Map) {
          final cp = details['contact_phone'] ?? details['contactPhone'];
          if (cp != null && cp.toString().trim().isNotEmpty) {
            _supportPhone = cp.toString().trim();
          }
          final cw = details['contact_whatsapp'] ?? details['contactWhatsapp'];
          if (cw != null && cw.toString().trim().isNotEmpty) {
            _contactWhatsapp = cw.toString().trim();
          }
        }
        _status = AuthStatus.accountLocked;
      }
      notifyListeners();
      return false;
    }
  }

  Future<bool> registerOwner({
    required String fullName,
    required String storeName,
    required String phone,
    required String password,
    required String passwordConfirmation,
    String? deviceFingerprint,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final account = await _repo.registerOwner(
        fullName: fullName,
        storeName: storeName,
        phone: phone,
        password: password,
        passwordConfirmation: passwordConfirmation,
        deviceFingerprint: deviceFingerprint,
      );
      _currentAccount = account;
      _accounts = await _repo.getAllAccounts();
      _status = AuthStatus.authenticated;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _isLoading = false;
      _errorMessage = formatUserError(e);
      notifyListeners();
      return false;
    }
  }

  Future<bool> changeTempPassword(
    String currentOrConfirmPassword,
    String newPassword, {
    String? newPasswordConfirmation,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final account = await _repo.changeTempPassword(
        currentPassword: currentOrConfirmPassword,
        newPassword: newPassword,
        newPasswordConfirmation: newPasswordConfirmation ?? newPassword,
      );
      _currentAccount = account;
      _accounts = await _repo.getAllAccounts();
      _status = AuthStatus.authenticated;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _isLoading = false;
      _errorMessage = formatUserError(e);
      notifyListeners();
      return false;
    }
  }

  Future<void> switchAccount(String accountId) async {
    _isLoading = true;
    notifyListeners();

    try {
      await _repo.switchAccount(accountId);
      _currentAccount = await _repo.getCurrentAccount();
      _accounts = await _repo.getAllAccounts();
      _status = _currentAccount != null ? AuthStatus.authenticated : AuthStatus.unauthenticated;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    _isLoading = true;
    notifyListeners();

    try {
      await _repo.logout();
      _currentAccount = await _repo.getCurrentAccount();
      _accounts = await _repo.getAllAccounts();
      _status = _currentAccount != null ? AuthStatus.authenticated : AuthStatus.unauthenticated;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }
}
