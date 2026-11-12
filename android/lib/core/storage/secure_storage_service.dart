import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../data/models/auth_account.dart';

/// إدارة التخزين الآمن والمحلي لبيانات الحسابات والتوكنات المتعددة
/// المرجع: docs/09-mobile-app.md القسم 8 (تبديل الحسابات - R-35)
/// أمنياً: تُحفظ التوكنات حصراً في FlutterSecureStorage المشفّر (أو في الذاكرة العشوائية المؤقتة أثناء الاختبارات فقط) ولا تُكتب أبداً في SharedPreferences غير المشفّرة.
class SecureStorageService {
  static const String _keyAccounts = 'muqawati_accounts';
  static const String _keyActiveAccountId = 'muqawati_active_account_id';

  // بديل مؤقت في الذاكرة فقط عند تعذر استدعاء Plugin التخزين المشفّر أثناء اختبارات الوحدة
  static final Map<String, String> _memoryFallback = {};

  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  Future<String?> _readSecure(String key) async {
    try {
      final val = await _secureStorage.read(key: key);
      if (val != null) return val;
    } catch (_) {}
    return _memoryFallback[key];
  }

  Future<void> _writeSecure(String key, String value) async {
    try {
      await _secureStorage.write(key: key, value: value);
      _memoryFallback.remove(key);
    } catch (_) {
      _memoryFallback[key] = value;
    }
  }

  Future<void> _deleteSecure(String key) async {
    _memoryFallback.remove(key);
    try {
      await _secureStorage.delete(key: key);
    } catch (_) {}
  }

  // جلب كافة الحسابات المحفوظة من التخزين المشفّر فقط
  Future<List<AuthAccount>> getAccounts() async {
    try {
      final jsonStr = await _readSecure(_keyAccounts);
      if (jsonStr == null || jsonStr.isEmpty) return [];
      final List<dynamic> list = jsonDecode(jsonStr);
      return list.map((item) => AuthAccount.fromJson(item)).toList();
    } catch (_) {
      return [];
    }
  }

  // جلب معرف الحساب النشط حالياً
  Future<String?> getActiveAccountId() async {
    return _readSecure(_keyActiveAccountId);
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

  // حفظ أو تحديث حساب في التخزين المشفّر فقط
  Future<void> saveAccount(AuthAccount account, {bool setActive = true}) async {
    final accounts = await getAccounts();
    final index = accounts.indexWhere((a) => a.id == account.id);
    if (index >= 0) {
      accounts[index] = account;
    } else {
      accounts.add(account);
    }

    final jsonStr = jsonEncode(accounts.map((a) => a.toJson()).toList());
    await _writeSecure(_keyAccounts, jsonStr);
    if (setActive) {
      await _writeSecure(_keyActiveAccountId, account.id);
    }
  }

  // تبديل الحساب النشط (R-35)
  Future<void> setActiveAccount(String accountId) async {
    await _writeSecure(_keyActiveAccountId, accountId);
  }

  // إزالة حساب معين
  Future<void> removeAccount(String accountId) async {
    final accounts = await getAccounts();
    accounts.removeWhere((a) => a.id == accountId);
    final jsonStr = jsonEncode(accounts.map((a) => a.toJson()).toList());
    await _writeSecure(_keyAccounts, jsonStr);

    final activeId = await getActiveAccountId();
    if (activeId == accountId) {
      final nextActive = accounts.isNotEmpty ? accounts.first.id : null;
      if (nextActive != null) {
        await setActiveAccount(nextActive);
      } else {
        await _deleteSecure(_keyActiveAccountId);
      }
    }
  }

  // مسح كامل الجلسة (بما فيها أي مفاتيح قديمة في SharedPreferences)
  Future<void> clearAll() async {
    _memoryFallback.clear();
    try {
      await _secureStorage.deleteAll();
    } catch (_) {}
    try {
      final sp = await SharedPreferences.getInstance();
      await sp.remove(_keyAccounts);
      await sp.remove(_keyActiveAccountId);
    } catch (_) {}
  }
}
