import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../data/models/auth_account.dart';

/// إدارة التخزين الآمن والمحلي لبيانات الحسابات والتوكنات المتعددة
/// المرجع: docs/09-mobile-app.md القسم 8 (تبديل الحسابات - R-35)
class SecureStorageService {
  static const String _keyAccounts = 'muqawati_accounts';
  static const String _keyActiveAccountId = 'muqawati_active_account_id';

  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  // جلب كافة الحسابات المحفوظة
  Future<List<AuthAccount>> getAccounts() async {
    try {
      final jsonStr = await _secureStorage.read(key: _keyAccounts);
      if (jsonStr == null || jsonStr.isEmpty) return [];
      final List<dynamic> list = jsonDecode(jsonStr);
      return list.map((item) => AuthAccount.fromJson(item)).toList();
    } catch (_) {
      // Fallback إلى SharedPreferences إن لزم
      final sp = await SharedPreferences.getInstance();
      final jsonStr = sp.getString(_keyAccounts);
      if (jsonStr == null || jsonStr.isEmpty) return [];
      final List<dynamic> list = jsonDecode(jsonStr);
      return list.map((item) => AuthAccount.fromJson(item)).toList();
    }
  }

  // جلب معرف الحساب النشط حالياً
  Future<String?> getActiveAccountId() async {
    try {
      final id = await _secureStorage.read(key: _keyActiveAccountId);
      if (id != null) return id;
    } catch (_) {}
    final sp = await SharedPreferences.getInstance();
    return sp.getString(_keyActiveAccountId);
  }

  // جلب الحساب النشط حالياً
  Future<AuthAccount?> getActiveAccount() async {
    final activeId = await getActiveAccountId();
    if (activeId == null) return null;
    final accounts = await getAccounts();
    try {
      return accounts.firstWhere((acc) => acc.id == activeId);
    } catch (_) {
      return accounts.isNotEmpty ? accounts.first : null;
    }
  }

  // حفظ أو تحديث حساب
  Future<void> saveAccount(AuthAccount account, {bool setActive = true}) async {
    final accounts = await getAccounts();
    final index = accounts.indexWhere((a) => a.id == account.id);
    if (index >= 0) {
      accounts[index] = account;
    } else {
      accounts.add(account);
    }

    final jsonStr = jsonEncode(accounts.map((a) => a.toJson()).toList());
    try {
      await _secureStorage.write(key: _keyAccounts, value: jsonStr);
      if (setActive) {
        await _secureStorage.write(key: _keyActiveAccountId, value: account.id);
      }
    } catch (_) {
      final sp = await SharedPreferences.getInstance();
      await sp.setString(_keyAccounts, jsonStr);
      if (setActive) {
        await sp.setString(_keyActiveAccountId, account.id);
      }
    }
  }

  // تبديل الحساب النشط (R-35)
  Future<void> setActiveAccount(String accountId) async {
    try {
      await _secureStorage.write(key: _keyActiveAccountId, value: accountId);
    } catch (_) {
      final sp = await SharedPreferences.getInstance();
      await sp.setString(_keyActiveAccountId, accountId);
    }
  }

  // إزالة حساب معين
  Future<void> removeAccount(String accountId) async {
    final accounts = await getAccounts();
    accounts.removeWhere((a) => a.id == accountId);
    final jsonStr = jsonEncode(accounts.map((a) => a.toJson()).toList());

    final sp = await SharedPreferences.getInstance();
    try {
      await _secureStorage.write(key: _keyAccounts, value: jsonStr);
    } catch (_) {
      await sp.setString(_keyAccounts, jsonStr);
    }

    final activeId = await getActiveAccountId();
    if (activeId == accountId) {
      final nextActive = accounts.isNotEmpty ? accounts.first.id : null;
      if (nextActive != null) {
        await setActiveAccount(nextActive);
      } else {
        await _secureStorage.delete(key: _keyActiveAccountId);
        await sp.remove(_keyActiveAccountId);
      }
    }
  }

  // مسح كامل الجلسة
  Future<void> clearAll() async {
    try {
      await _secureStorage.deleteAll();
    } catch (_) {}
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_keyAccounts);
    await sp.remove(_keyActiveAccountId);
  }
}
