import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../data/local/app_database.dart';

class CreditCustomer {
  final String id;
  final String name;
  final String? phone;
  final double? creditLimit;
  final double totalDebt;

  CreditCustomer({
    required this.id,
    required this.name,
    this.phone,
    this.creditLimit,
    required this.totalDebt,
  });

  factory CreditCustomer.fromJson(Map<String, dynamic> json) {
    return CreditCustomer(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      phone: json['phone']?.toString(),
      creditLimit: ((json['credit_limit'] ?? json['creditLimit']) as num?)?.toDouble(),
      totalDebt: ((json['total_debt'] ?? json['totalDebt']) as num?)?.toDouble() ?? 0.0,
    );
  }
}

class CreditProvider with ChangeNotifier {
  final ApiClient _api;
  final _uuid = const Uuid();

  List<CreditCustomer> _customers = [];
  bool _isLoading = false;
  String? _errorMessage;
  String? _errorCode;
  bool _lastOperationQueuedOffline = false;

  CreditProvider(this._api);

  List<CreditCustomer> get customers => _customers;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get errorCode => _errorCode;
  bool get lastOperationQueuedOffline => _lastOperationQueuedOffline;

  Future<void> fetchCustomers({String? search, String? storeOwnerId}) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      final res = await _api.get(
        ApiEndpoints.creditCustomers,
        queryParameters: search != null && search.isNotEmpty ? {'search': search} : null,
      );
      final List<dynamic> list = res.data ?? [];
      final fetched = list.map((e) => CreditCustomer.fromJson(e)).toList();
      _customers = fetched;

      if (storeOwnerId != null && storeOwnerId.isNotEmpty) {
        try {
          final db = await AppDatabase.getInstance(storeOwnerId);
          for (final c in fetched) {
            await db.insert(
              'credit_customers',
              {
                'id': c.id,
                'name': c.name,
                'phone': c.phone,
                'credit_limit': c.creditLimit,
                'total_debt': c.totalDebt,
              },
              conflictAlgorithm: ConflictAlgorithm.replace,
            );
          }
        } catch (_) {}
      }
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        await _loadOfflineCustomers(storeOwnerId, search: search);
      } else {
        _errorCode = e.code;
        _errorMessage = e.message;
      }
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _loadOfflineCustomers(String storeOwnerId, {String? search}) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      final rows = await db.query(
        'credit_customers',
        orderBy: 'name ASC',
      );
      var list = rows.map((r) => CreditCustomer.fromJson(r)).toList();
      if (search != null && search.trim().isNotEmpty) {
        final q = search.trim().toLowerCase();
        list = list
            .where((c) =>
                c.name.toLowerCase().contains(q) ||
                (c.phone ?? '').contains(q))
            .toList();
      }
      _customers = list;
    } catch (_) {}
  }

  Future<bool> addCustomer({
    required String name,
    String? phone,
    double? creditLimit,
    String? storeOwnerId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      await _api.post(
        ApiEndpoints.creditCustomers,
        data: {
          'name': name,
          if (phone != null && phone.isNotEmpty) 'phone': phone,
          if (creditLimit != null) 'creditLimit': creditLimit,
        },
      );
      await fetchCustomers(storeOwnerId: storeOwnerId);
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// تحصيل دين آجل (Offline-capable عبر CREDIT_PAYMENT في طابور المزامنة)
  Future<bool> collectDebt({
    required String customerId,
    required double amount,
    String paymentMethod = 'CASH',
    String? walletId,
    String? attachmentUrl,
    String? notes,
    String? storeOwnerId,
    String? clientOpId,
  }) {
    return recordPayment(
      customerId: customerId,
      amount: amount,
      paymentMethod: paymentMethod,
      walletId: walletId,
      attachmentUrl: attachmentUrl,
      notes: notes,
      storeOwnerId: storeOwnerId,
      clientOpId: clientOpId,
    );
  }

  Future<bool> recordPayment({
    required String customerId,
    required double amount,
    String paymentMethod = 'CASH',
    String? walletId,
    String? attachmentUrl,
    String? notes,
    String? storeOwnerId,
    String? clientOpId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    _lastOperationQueuedOffline = false;
    notifyListeners();

    if (amount <= 0) {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'مبلغ الدفعة يجب أن يكون أكبر من صفر.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (paymentMethod != 'CASH' && paymentMethod != 'ELECTRONIC') {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'طريقة الدفع يجب أن تكون نقداً أو إلكترونياً فقط.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (paymentMethod == 'ELECTRONIC' &&
        (walletId == null ||
            walletId.trim().isEmpty ||
            attachmentUrl == null ||
            attachmentUrl.trim().isEmpty)) {
      _errorCode = 'MISSING_DEPOSIT_ATTACHMENT';
      _errorMessage =
          'اختيار المحفظة الإلكترونية وإرفاق صورة إيصال الإيداع إلزاميان عند سداد دين العميل إلكترونياً.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    final opId = (clientOpId != null && clientOpId.trim().isNotEmpty)
        ? clientOpId.trim()
        : _uuid.v4();

    var finalAttachmentUrl = attachmentUrl;
    if (finalAttachmentUrl != null && finalAttachmentUrl.trim().isNotEmpty) {
      final isLocal = !finalAttachmentUrl.startsWith('http') &&
          !finalAttachmentUrl.startsWith('/v1/uploads/');
      if (isLocal) {
        try {
          finalAttachmentUrl = await _api.uploadFile(finalAttachmentUrl);
        } catch (_) {}
      }
    }

    final payload = <String, dynamic>{
      'id': opId,
      'clientOpId': opId,
      'customerId': customerId,
      'amount': amount,
      'paymentMethod': paymentMethod,
      if (walletId != null && walletId.isNotEmpty) 'walletId': walletId,
      if (finalAttachmentUrl != null && finalAttachmentUrl.isNotEmpty)
        'attachmentUrl': finalAttachmentUrl,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    };

    try {
      await _api.post(
        ApiEndpoints.creditPayments(customerId),
        data: payload,
      );
      await fetchCustomers(storeOwnerId: storeOwnerId);
      return true;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        return await _enqueueOfflineCreditPayment(
          storeOwnerId: storeOwnerId,
          opId: opId,
          customerId: customerId,
          amount: amount,
          paymentMethod: paymentMethod,
          walletId: walletId,
          attachmentUrl: attachmentUrl,
          payload: payload,
        );
      }
      _errorCode = e.code;
      _errorMessage = e.message;
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> _enqueueOfflineCreditPayment({
    required String storeOwnerId,
    required String opId,
    required String customerId,
    required double amount,
    required String paymentMethod,
    String? walletId,
    String? attachmentUrl,
    required Map<String, dynamic> payload,
  }) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);

      // فحص منع تطبيق نفس عملية التحصيل مرتين على رصيد العميل
      final existingTx = await db.query(
        'credit_transactions',
        where: 'id = ?',
        whereArgs: [opId],
        limit: 1,
      );
      if (existingTx.isNotEmpty) {
        await AppDatabase.enqueueOperation(
          db,
          clientOpId: opId,
          opType: 'CREDIT_PAYMENT',
          payload: payload,
        );
        _lastOperationQueuedOffline = true;
        await _loadOfflineCustomers(storeOwnerId);
        _isLoading = false;
        notifyListeners();
        return true;
      }

      final custRows = await db.query(
        'credit_customers',
        where: 'id = ?',
        whereArgs: [customerId],
        limit: 1,
      );
      if (custRows.isEmpty) {
        _errorCode = 'NOT_FOUND';
        _errorMessage = 'عميل الآجل غير موجود محلياً.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      final currentDebt = (custRows.first['total_debt'] as num?)?.toDouble() ?? 0.0;
      if (amount > currentDebt + 0.005) {
        _errorCode = 'VALIDATION_ERROR';
        _errorMessage = 'مبلغ السداد يتجاوز الرصيد المستحق حالياً على العميل.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      final nextDebt = ((currentDebt - amount) * 100).roundToDouble() / 100.0;
      final nowIso = DateTime.now().toIso8601String();

      await db.transaction((txn) async {
        await txn.update(
          'credit_customers',
          {'total_debt': nextDebt < 0 ? 0.0 : nextDebt},
          where: 'id = ?',
          whereArgs: [customerId],
        );

        await txn.insert(
          'credit_transactions',
          {
            'id': opId,
            'customer_id': customerId,
            'tx_type': 'CREDIT_PAYMENT',
            'amount': amount,
            'notes': payload['notes']?.toString(),
            'created_at': nowIso,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );

        await AppDatabase.enqueueOperation(
          txn,
          clientOpId: opId,
          opType: 'CREDIT_PAYMENT',
          payload: payload,
        );
      });

      _lastOperationQueuedOffline = true;
      await _loadOfflineCustomers(storeOwnerId);
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (err) {
      _errorMessage = err.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<Map<String, dynamic>?> fetchStatement(String customerId) async {
    try {
      final res = await _api.get(ApiEndpoints.creditStatement(customerId));
      if (res.data is Map) {
        return Map<String, dynamic>.from(res.data);
      }
      return null;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return null;
    }
  }
}
