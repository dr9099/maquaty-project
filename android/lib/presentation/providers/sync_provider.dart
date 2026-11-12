import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../core/services/device_info_service.dart';
import '../../data/local/app_database.dart';

/// نتيجة عملية المزامنة السحابية
class SyncResult {
  final bool success;
  final int processedCount;
  final int newSyncVersion;
  final String? accountStatus;
  final String? minAppVersion;
  final bool updateRequired;
  final String? errorMessage;

  SyncResult({
    required this.success,
    this.processedCount = 0,
    this.newSyncVersion = 0,
    this.accountStatus,
    this.minAppVersion,
    this.updateRequired = false,
    this.errorMessage,
  });
}

/// مزود المزامنة السحابية والنسخ الاحتياطي الفعلي (R-26 / R-30 / BR-076)
class SyncProvider with ChangeNotifier {
  final ApiClient _api;

  /// إصدار التطبيق الحالي وفق pubspec.yaml (قابل للتخصيص في الاختبارات)
  String _currentAppVersion = '1.0.0';
  String? _minAppVersion;
  bool _isUpdateRequired = false;

  bool _isLoading = false;
  bool _isSyncing = false;
  bool _isBackingUp = false;
  bool _isRestoring = false;

  int _pendingCount = 0;
  int _lastSyncVersion = 0;
  DateTime? _lastSyncAt;
  DateTime? _lastBackupAt;
  int? _lastBackupSizeBytes;
  String? _lastBackupPath;
  String? _subscriptionStatus;
  String? _errorMessage;

  SyncProvider(this._api, {String currentAppVersion = '1.0.0'})
      : _currentAppVersion = currentAppVersion;

  bool get isLoading => _isLoading;
  bool get isSyncing => _isSyncing;
  bool get isBackingUp => _isBackingUp;
  bool get isRestoring => _isRestoring;

  int get pendingCount => _pendingCount;
  int get lastSyncVersion => _lastSyncVersion;
  DateTime? get lastSyncAt => _lastSyncAt;
  DateTime? get lastBackupAt => _lastBackupAt;
  int? get lastBackupSizeBytes => _lastBackupSizeBytes;
  String? get lastBackupPath => _lastBackupPath;
  String? get subscriptionStatus => _subscriptionStatus;
  String get currentAppVersion => _currentAppVersion;
  String? get minAppVersion => _minAppVersion;
  bool get isUpdateRequired => _isUpdateRequired;
  String? get errorMessage => _errorMessage;

  @visibleForTesting
  void setCurrentAppVersionForTesting(String version) {
    _currentAppVersion = version;
    if (_minAppVersion != null) {
      _isUpdateRequired = isVersionOlder(_currentAppVersion, _minAppVersion!);
    }
    notifyListeners();
  }

  /// مقارنة إصدار التطبيق الحالي مع أدنى إصدار مطلوب من الخادم (Semantic Versioning)
  static bool isVersionOlder(String currentVersion, String minVersion) {
    List<int> parseParts(String v) {
      final clean = v.trim().split('+').first.split('-').first;
      return clean
          .split('.')
          .map((part) => int.tryParse(part.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0)
          .toList();
    }

    final curr = parseParts(currentVersion);
    final min = parseParts(minVersion);
    final maxLen = curr.length > min.length ? curr.length : min.length;

    for (var i = 0; i < maxLen; i++) {
      final c = i < curr.length ? curr[i] : 0;
      final m = i < min.length ? min[i] : 0;
      if (c < m) return true;
      if (c > m) return false;
    }
    return false;
  }

  /// تحميل حالة المزامنة والنسخ الاحتياطي الحالية من قاعدة البيانات المحلية
  Future<void> loadStatus(String storeOwnerId) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      _pendingCount = await AppDatabase.getPendingCount(db);

      // قراءة بيانات آخر مزامنة
      final verStr = await AppDatabase.getStoreSetting(db, 'last_sync_version');
      _lastSyncVersion = int.tryParse(verStr ?? '0') ?? 0;

      final lastSyncStr = await AppDatabase.getStoreSetting(db, 'last_sync_at');
      _lastSyncAt = lastSyncStr != null ? DateTime.tryParse(lastSyncStr) : null;

      final subStatusStr = await AppDatabase.getStoreSetting(db, 'subscription_status');
      if (subStatusStr != null && subStatusStr.isNotEmpty) {
        _subscriptionStatus = subStatusStr;
      }

      final minVerStr = await AppDatabase.getStoreSetting(db, 'min_app_version');
      if (minVerStr != null && minVerStr.isNotEmpty) {
        _minAppVersion = minVerStr;
        _isUpdateRequired = isVersionOlder(_currentAppVersion, minVerStr);
      }

      // قراءة بيانات النسخة الاحتياطية
      final backupInfo = await AppDatabase.getLocalBackupInfo(storeOwnerId);
      if (backupInfo != null) {
        _lastBackupAt = backupInfo['createdAt'] as DateTime?;
        _lastBackupSizeBytes = backupInfo['sizeBytes'] as int?;
        _lastBackupPath = backupInfo['path'] as String?;
      } else {
        final lastBackupStr = await AppDatabase.getStoreSetting(db, 'last_local_backup_at');
        _lastBackupAt = lastBackupStr != null ? DateTime.tryParse(lastBackupStr) : null;
        final sizeStr = await AppDatabase.getStoreSetting(db, 'last_local_backup_size');
        _lastBackupSizeBytes = int.tryParse(sizeStr ?? '');
        _lastBackupPath = await AppDatabase.getStoreSetting(db, 'last_local_backup_path');
      }
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// تنفيذ المزامنة السحابية الحقيقية مع الخادم عبر POST /v1/device/sync
  Future<SyncResult> syncWithServer({
    required String storeOwnerId,
    Function(String newStatus)? onStatusUpdated,
    Function(String minAppVersion)? onMinVersionRequired,
  }) async {
    _isSyncing = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      final fingerprint = await DeviceInfoService.getDeviceFingerprint();

      // قراءة كافة العمليات المعلقة
      final rawPending = await AppDatabase.getPendingOperations(db);
      final pendingLocalOperations = <Map<String, dynamic>>[];

      for (final row in rawPending) {
        dynamic parsedPayload = row['payload'];
        if (parsedPayload is String) {
          try {
            parsedPayload = jsonDecode(parsedPayload);
          } catch (_) {}
        }
        final payloadMap = parsedPayload is Map
            ? Map<String, dynamic>.from(parsedPayload)
            : <String, dynamic>{};

        // فحص ورفع أي مرفق محلي قبل إرسال العملية إلى السيرفر
        final attachmentKeys = [
          'depositAttachmentUrl',
          'attachmentUrl',
          'receiptAttachmentUrl',
          'photoUrl',
        ];
        var payloadModified = false;
        for (final k in attachmentKeys) {
          final val = payloadMap[k]?.toString();
          if (val != null && val.trim().isNotEmpty) {
            final isLocal =
                !val.startsWith('http') && !val.startsWith('/v1/uploads/');
            if (isLocal) {
              try {
                final serverUrl = await _api.uploadFile(val.trim());
                payloadMap[k] = serverUrl;
                payloadModified = true;
              } catch (_) {
                // في حال تعذر الرفع نحتفظ بالمسار المحلي
              }
            }
          }
        }

        if (payloadModified) {
          try {
            await db.update(
              'sync_queue',
              {'payload': jsonEncode(payloadMap)},
              where: 'client_op_id = ?',
              whereArgs: [row['client_op_id']],
            );
          } catch (_) {}
        }

        pendingLocalOperations.add({
          'clientOpId': row['client_op_id'],
          'opType': row['op_type'],
          'payload': payloadMap,
          'createdAt': row['created_at'],
        });
      }

      final payload = {
        'deviceFingerprint': fingerprint,
        'lastSyncVersion': _lastSyncVersion,
        if (pendingLocalOperations.isNotEmpty)
          'pendingLocalOperations': pendingLocalOperations,
      };

      final res = await _api.post(ApiEndpoints.deviceSync, data: payload);
      final data = res.data is Map<String, dynamic>
          ? res.data as Map<String, dynamic>
          : Map<String, dynamic>.from(res.data as Map);

      final newSyncVersion =
          (data['new_sync_version'] as num?)?.toInt() ?? (_lastSyncVersion + 1);
      final accountStatus = data['account_status']?.toString();
      final minAppVersion = data['min_app_version']?.toString();
      final processedOps = (data['processed_operations'] as List?) ?? [];
      final rejectedOps = (data['rejectedOperations'] ?? data['rejected_operations']) as List?;
      final allProcessedOps = [...processedOps];
      if (rejectedOps != null) {
        for (final r in rejectedOps) {
          final rMap = r is Map<String, dynamic> ? r : Map<String, dynamic>.from(r as Map);
          final cId = rMap['clientOperationId'] ?? rMap['client_op_id'] ?? rMap['clientOpId'];
          if (cId != null &&
              !allProcessedOps.any((p) =>
                  (p is Map && (p['client_op_id'] == cId || p['clientOpId'] == cId)))) {
            allProcessedOps.add({
              'client_op_id': cId,
              'status': 'REJECTED',
              'error_code': rMap['errorCode'] ?? rMap['error_code'] ?? 'REJECTED',
              'message': rMap['reason'] ?? rMap['message'],
            });
          }
        }
      }

      // 1) تحديث العمليات المعالجة في sync_queue وتسوية العمليات المرفوضة
      if (allProcessedOps.isNotEmpty) {
        await AppDatabase.markOperationsProcessed(db, allProcessedOps);
      }

      final serverUpdates =
          data['server_updates'] is Map
              ? Map<String, dynamic>.from(data['server_updates'] as Map)
              : <String, dynamic>{};

      // 2) تطبيق التحديثات العائدة من السيرفر على الجداول المحلية
      if (serverUpdates.isNotEmpty) {
        await AppDatabase.applyServerUpdates(db, serverUpdates);
      }

      // 3) حفظ رقم الإصدار وتاريخ المزامنة وفحص أدنى إصدار مطلوب للتطبيق (min_app_version)
      final now = DateTime.now();
      _lastSyncVersion = newSyncVersion;
      _lastSyncAt = now;
      if (accountStatus != null) {
        _subscriptionStatus = accountStatus;
        onStatusUpdated?.call(accountStatus);
      }

      var updateRequired = false;
      if (minAppVersion != null && minAppVersion.trim().isNotEmpty) {
        _minAppVersion = minAppVersion.trim();
        await AppDatabase.setStoreSetting(db, 'min_app_version', _minAppVersion!);
        updateRequired = isVersionOlder(_currentAppVersion, _minAppVersion!);
        _isUpdateRequired = updateRequired;
        if (updateRequired) {
          onMinVersionRequired?.call(_minAppVersion!);
        }
      }

      await AppDatabase.setStoreSetting(
        db,
        'last_sync_version',
        newSyncVersion.toString(),
      );
      await AppDatabase.setStoreSetting(
        db,
        'last_sync_at',
        now.toIso8601String(),
      );
      if (accountStatus != null) {
        await AppDatabase.setStoreSetting(
          db,
          'subscription_status',
          accountStatus,
        );
      }

      _pendingCount = await AppDatabase.getPendingCount(db);
      _isSyncing = false;
      notifyListeners();

      return SyncResult(
        success: true,
        processedCount: processedOps.length,
        newSyncVersion: newSyncVersion,
        accountStatus: accountStatus,
        minAppVersion: _minAppVersion,
        updateRequired: updateRequired,
      );
    } catch (e) {
      _isSyncing = false;
      _errorMessage = e.toString();
      notifyListeners();
      return SyncResult(
        success: false,
        errorMessage: e.toString(),
      );
    }
  }

  /// إنشاء نسخة احتياطية محلية فعلية لقاعدة بيانات المتجر
  Future<Map<String, dynamic>> createLocalBackup(String storeOwnerId) async {
    _isBackingUp = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final info = await AppDatabase.exportLocalBackup(storeOwnerId);
      _lastBackupAt = info['createdAt'] as DateTime?;
      _lastBackupSizeBytes = info['sizeBytes'] as int?;
      _lastBackupPath = info['path'] as String?;
      return info;
    } catch (e) {
      _errorMessage = e.toString();
      rethrow;
    } finally {
      _isBackingUp = false;
      notifyListeners();
    }
  }

  /// استعادة البيانات من النسخة الاحتياطية المحلية
  Future<bool> restoreLocalBackup(String storeOwnerId) async {
    _isRestoring = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final ok = await AppDatabase.restoreFromLocalBackup(storeOwnerId);
      await loadStatus(storeOwnerId);
      return ok;
    } catch (e) {
      _errorMessage = e.toString();
      rethrow;
    } finally {
      _isRestoring = false;
      notifyListeners();
    }
  }
}

