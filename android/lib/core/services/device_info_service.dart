import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// خدمة استخراج وإدارة بصمة الجهاز الفريدة (R-25)
/// تضمن استخراج معرف ثابت ومميز لكل جهاز مع حفظه محلياً لضمان عدم تغييره
class DeviceInfoService {
  static const String _storageKey = 'muqawati_device_fingerprint';
  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage();
  static final DeviceInfoPlugin _deviceInfoPlugin = DeviceInfoPlugin();
  static String? _cachedFingerprint;

  /// الحصول على بصمة الجهاز الفريدة (من الذاكرة، ثم التخزين الآمن، أو توليدها وحفظها)
  static Future<String> getDeviceFingerprint() async {
    if (_cachedFingerprint != null && _cachedFingerprint!.isNotEmpty) {
      return _cachedFingerprint!;
    }

    // 1) محاولة القراءة من التخزين الآمن
    try {
      final saved = await _secureStorage.read(key: _storageKey);
      if (saved != null && saved.trim().isNotEmpty) {
        _cachedFingerprint = saved.trim();
        return _cachedFingerprint!;
      }
    } catch (_) {}

    // 2) محاولة القراءة من SharedPreferences كبديل
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_storageKey);
      if (saved != null && saved.trim().isNotEmpty) {
        _cachedFingerprint = saved.trim();
        try {
          await _secureStorage.write(key: _storageKey, value: _cachedFingerprint);
        } catch (_) {}
        return _cachedFingerprint!;
      }
    } catch (_) {}

    // 3) توليد بصمة فريدة بالاعتماد على خصائص العتاد والنظام
    String rawId = '';
    try {
      if (kIsWeb) {
        final webInfo = await _deviceInfoPlugin.webBrowserInfo;
        final hash = webInfo.userAgent?.hashCode ?? const Uuid().v4();
        rawId = 'WEB_$hash';
      } else if (Platform.isAndroid) {
        final androidInfo = await _deviceInfoPlugin.androidInfo;
        final id = androidInfo.id.isNotEmpty ? androidInfo.id : androidInfo.fingerprint;
        rawId = 'AND_${id}_${androidInfo.model}'.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
      } else if (Platform.isIOS) {
        final iosInfo = await _deviceInfoPlugin.iosInfo;
        final id = iosInfo.identifierForVendor ?? const Uuid().v4();
        rawId = 'IOS_${id}_${iosInfo.model}'.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
      } else {
        rawId = 'DEV_${const Uuid().v4()}';
      }
    } catch (_) {
      rawId = 'DEV_${const Uuid().v4()}';
    }

    if (rawId.isEmpty) {
      rawId = 'DEV_${const Uuid().v4()}';
    }

    _cachedFingerprint = rawId;

    // 4) حفظ البصمة محلياً لضمان ثباتها الدائم للجهاز
    try {
      await _secureStorage.write(key: _storageKey, value: rawId);
    } catch (_) {}

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_storageKey, rawId);
    } catch (_) {}

    return _cachedFingerprint!;
  }
}
