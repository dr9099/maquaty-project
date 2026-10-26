import 'package:flutter/foundation.dart';
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

  AuthProvider(this._repo);

  AuthStatus get status => _status;
  AuthAccount? get currentAccount => _currentAccount;
  List<AuthAccount> get accounts => _accounts;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get lockReason => _lockReason;

  bool get isAuthenticated => _status == AuthStatus.authenticated && _currentAccount != null;
  bool get isOwner => _currentAccount?.role == 'STORE_OWNER';
  bool get isResponsibleWorker => _currentAccount?.isResponsibleWorker ?? false;

  // فحص الصلاحيات الفردية (BR-010 / docs/06-user-roles-permissions.md)
  bool get canViewFunds => isOwner || isResponsibleWorker;
  bool get canManageCredit => isOwner || isResponsibleWorker;
  bool get canEnterOwnAdvance {
    if (isOwner) return true;
    if (isResponsibleWorker) {
      return _currentAccount?.permissions['perm_enter_own_advance'] == true;
    }
    return false;
  }
  bool get canViewReports {
    if (isOwner || isResponsibleWorker) return true;
    return _currentAccount?.permissions['perm_reports_access'] == true;
  }
  bool get canRecordDamagedGoods {
    if (isOwner || isResponsibleWorker) return true;
    return _currentAccount?.permissions['perm_damaged_goods'] == true;
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
    notifyListeners();

    try {
      final account = await _repo.login(phone: phone, password: password);
      _currentAccount = account;
      _accounts = await _repo.getAllAccounts();
      _status = AuthStatus.authenticated;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _isLoading = false;
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> registerOwner({
    required String name,
    required String storeName,
    required String phone,
    required String password,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final account = await _repo.registerOwner(
        name: name,
        storeName: storeName,
        phone: phone,
        password: password,
      );
      _currentAccount = account;
      _accounts = await _repo.getAllAccounts();
      _status = AuthStatus.authenticated;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _isLoading = false;
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> changeTempPassword(String currentPassword, String newPassword) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _repo.changeTempPassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
      _status = AuthStatus.authenticated;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _isLoading = false;
      _errorMessage = e.toString();
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
