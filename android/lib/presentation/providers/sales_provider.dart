import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../core/utils/quantity_formatter.dart';
import '../../data/local/app_database.dart';

class SaleRecord {
  final String id;
  final String type;
  final String itemName;
  final String unit;
  final double quantity;
  final String? quantityDisplay;
  final double amount;
  final String paymentType;
  final bool isEmergencySale;
  final double? emergencyOverridePrice;
  final String? emergencyReason;
  final DateTime soldAt;
  final String? workerName;

  SaleRecord({
    required this.id,
    this.type = 'SALE',
    required this.itemName,
    this.unit = 'كيلو',
    required this.quantity,
    this.quantityDisplay,
    required this.amount,
    required this.paymentType,
    this.isEmergencySale = false,
    this.emergencyOverridePrice,
    this.emergencyReason,
    required this.soldAt,
    this.workerName,
  });

  String get displayQuantity =>
      quantityDisplay ?? formatQuantityDisplay(quantity, unit: unit);

  bool get isCreditPayment => type == 'CREDIT_PAYMENT';

  factory SaleRecord.fromJson(Map<String, dynamic> json) {
    final unitVal = (json['item']?['unit'] ?? json['unit'] ?? 'كيلو').toString();
    final qtyVal = (json['quantity'] as num?)?.toDouble() ?? 0.0;
    return SaleRecord(
      id: (json['id'] ?? '').toString(),
      type: (json['type'] ?? 'SALE').toString(),
      itemName: (json['item_name'] ?? json['item']?['name'] ?? json['itemName'] ?? 'صنف').toString(),
      unit: unitVal,
      quantity: qtyVal,
      quantityDisplay: json['quantity_display']?.toString() ?? formatQuantityDisplay(qtyVal, unit: unitVal),
      amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
      paymentType: (json['payment_type'] ?? json['paymentType'] ?? json['payment_method'] ?? 'CASH').toString(),
      isEmergencySale: json['is_emergency_sale'] == true || json['isEmergencySale'] == true || json['is_emergency'] == true,
      emergencyOverridePrice: ((json['emergency_override_price'] ?? json['emergencyOverridePrice']) as num?)?.toDouble(),
      emergencyReason: (json['emergency_reason'] ?? json['emergencyReason'])?.toString(),
      soldAt: DateTime.tryParse((json['sold_at'] ?? json['at'] ?? json['soldAt'] ?? '').toString()) ?? DateTime.now(),
      workerName: (json['worker_name'] ?? json['worker']?['fullName'] ?? json['worker']?['name'] ?? json['workerName'])?.toString(),
    );
  }
}

class SalesTotals {
  final double cash;
  final double electronic;
  final double expenses;

  SalesTotals({
    this.cash = 0.0,
    this.electronic = 0.0,
    this.expenses = 0.0,
  });

  factory SalesTotals.fromJson(Map<String, dynamic> json) {
    return SalesTotals(
      cash: (json['cash'] as num?)?.toDouble() ?? 0.0,
      electronic: (json['electronic'] as num?)?.toDouble() ?? 0.0,
      expenses: (json['expenses'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class SalesProvider with ChangeNotifier {
  final ApiClient _api;
  final _uuid = const Uuid();

  List<SaleRecord> _todaySales = [];
  SalesTotals? _totals;
  bool _isLoading = false;
  String? _errorMessage;
  String? _errorCode;
  String? _lastAccountStatus;
  bool _lastOperationQueuedOffline = false;

  SalesProvider(this._api);

  List<SaleRecord> get todaySales => _todaySales;
  SalesTotals? get totals => _totals;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get errorCode => _errorCode;
  String? get lastAccountStatus => _lastAccountStatus;
  bool get lastOperationQueuedOffline => _lastOperationQueuedOffline;

  Future<void> fetchTodaySales({String? storeOwnerId}) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final res = await _api.get(ApiEndpoints.salesToday);
      final raw = res.data;
      final List<dynamic> list = raw is List
          ? raw
          : (raw is Map ? (raw['operations'] ?? raw['sales'] ?? raw['items'] ?? []) : []);
      _todaySales = list
          .map((e) => SaleRecord.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      if (raw is Map && raw['totals'] is Map) {
        _totals = SalesTotals.fromJson(Map<String, dynamic>.from(raw['totals']));
      } else {
        double c = 0.0;
        double el = 0.0;
        for (final s in _todaySales) {
          if (s.paymentType == 'CASH') c += s.amount;
          if (s.paymentType == 'ELECTRONIC') el += s.amount;
        }
        _totals = SalesTotals(cash: c, electronic: el, expenses: 0.0);
      }
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        await _loadOfflineTodaySales(storeOwnerId);
      } else {
        _errorMessage = e.message;
      }
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _loadOfflineTodaySales(String storeOwnerId) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      final now = DateTime.now();
      final todayPrefix =
          '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final rows = await db.rawQuery('''
        SELECT s.*, i.name AS item_name, i.unit AS unit
        FROM sales s
        LEFT JOIN items i ON i.id = s.item_id
        WHERE s.sold_at LIKE ?
        ORDER BY s.sold_at DESC
      ''', ['$todayPrefix%']);
      _todaySales = rows.map((r) => SaleRecord.fromJson(r)).toList();
    } catch (_) {}
  }

  static bool _isWeightUnit(String unit) {
    final u = unit.trim().toLowerCase();
    return const {
      'كيلو',
      'كجم',
      'كيلوغرام',
      'كيلوجرام',
      'kg',
      'kilo',
      'kilogram',
      'جرام',
      'جم',
      'غ',
      'g',
      'gram',
    }.contains(u);
  }

  static bool _isKiloUnit(String unit) {
    final u = unit.trim().toLowerCase();
    return const {
      'كيلو',
      'كجم',
      'كيلوغرام',
      'كيلوجرام',
      'kg',
      'kilo',
      'kilogram',
    }.contains(u);
  }

  Future<bool> createSale({
    required String itemId,
    required double quantity,
    String? quantityUnit,
    required double amount,
    required String paymentType,
    String? walletId,
    String? depositAttachmentUrl,
    String? creditCustomerId,
    bool isEmergencySale = false,
    double? emergencyOverridePrice,
    String? emergencyReason,
    String? storeOwnerId,
    String? workerId,
    bool isOwner = true,
    bool isResponsibleWorker = false,
    String? clientOpId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    _lastOperationQueuedOffline = false;
    notifyListeners();

    if (quantity <= 0 || amount <= 0) {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'الكمية والمبلغ يجب أن يكونا أكبر من صفر.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (quantityUnit == 'GRAM' && (quantity - quantity.roundToDouble()).abs() > 1e-6) {
      _errorCode = 'FRACTIONAL_GRAMS_NOT_ALLOWED';
      _errorMessage = 'الكمية بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (paymentType == 'CREDIT' && !isOwner && !isResponsibleWorker) {
      _errorCode = 'PERMISSION_DENIED';
      _errorMessage = 'لا تملك صلاحية البيع بالآجل.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (paymentType == 'ELECTRONIC' &&
        (walletId == null ||
            walletId.trim().isEmpty ||
            depositAttachmentUrl == null ||
            depositAttachmentUrl.trim().isEmpty)) {
      _errorCode = 'MISSING_DEPOSIT_ATTACHMENT';
      _errorMessage = 'اختيار المحفظة ورفع صورة الإيداع إلزاميان عند الدفع الإلكتروني.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (paymentType == 'CREDIT' &&
        (creditCustomerId == null || creditCustomerId.trim().isEmpty)) {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'اختيار عميل الآجل إلزامي عند الدفع بالآجل.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (isEmergencySale) {
      if (emergencyReason == null || emergencyReason.trim().isEmpty) {
        _errorCode = 'EMERGENCY_REASON_REQUIRED';
        _errorMessage = 'سبب التعديل إلزامي للبيع الاضطراري.';
        _isLoading = false;
        notifyListeners();
        return false;
      }
      if (emergencyOverridePrice == null || emergencyOverridePrice <= 0) {
        _errorCode = 'VALIDATION_ERROR';
        _errorMessage = 'سعر البيع الاضطراري مطلوب.';
        _isLoading = false;
        notifyListeners();
        return false;
      }
    }

    final opId = (clientOpId != null && clientOpId.trim().isNotEmpty)
        ? clientOpId.trim()
        : _uuid.v4();
    final soldAtIso = DateTime.now().toIso8601String();

    var finalAttachmentUrl = depositAttachmentUrl;
    if (finalAttachmentUrl != null && finalAttachmentUrl.trim().isNotEmpty) {
      final isLocal = !finalAttachmentUrl.startsWith('http') &&
          !finalAttachmentUrl.startsWith('/v1/uploads/');
      if (isLocal) {
        try {
          finalAttachmentUrl = await _api.uploadFile(finalAttachmentUrl);
        } catch (_) {
          // في حال انقطاع الشبكة أو الفشل نحتفظ بالمسار المحلي
        }
      }
    }

    final payload = <String, dynamic>{
      'id': opId,
      'clientOpId': opId,
      'itemId': itemId,
      'quantity': quantity,
      if (quantityUnit != null) 'quantityUnit': quantityUnit,
      'amount': amount,
      'paymentType': paymentType,
      if (walletId != null) 'walletId': walletId,
      if (finalAttachmentUrl != null) 'depositAttachmentUrl': finalAttachmentUrl,
      if (creditCustomerId != null) 'creditCustomerId': creditCustomerId,
      if (isEmergencySale) ...{
        'isEmergencySale': true,
        'emergencyOverridePrice': emergencyOverridePrice,
        'emergencyReason': emergencyReason,
      },
      'soldAt': soldAtIso,
    };

    try {
      final res = await _api.post(
        ApiEndpoints.sales,
        data: payload,
      );
      if (res.data is Map) {
        final status = (res.data['account_status'] ?? res.data['accountStatus'])?.toString();
        if (status != null && status.isNotEmpty) {
          _lastAccountStatus = status;
        }
      }
      await fetchTodaySales(storeOwnerId: storeOwnerId);
      return true;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        return await _enqueueOfflineSale(
          storeOwnerId: storeOwnerId,
          workerId: workerId,
          opId: opId,
          itemId: itemId,
          quantity: quantity,
          quantityUnit: quantityUnit,
          amount: amount,
          paymentType: paymentType,
          walletId: walletId,
          depositAttachmentUrl: depositAttachmentUrl,
          creditCustomerId: creditCustomerId,
          isEmergencySale: isEmergencySale,
          emergencyOverridePrice: emergencyOverridePrice,
          emergencyReason: emergencyReason,
          soldAtIso: soldAtIso,
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

  Future<bool> _enqueueOfflineSale({
    required String storeOwnerId,
    String? workerId,
    required String opId,
    required String itemId,
    required double quantity,
    String? quantityUnit,
    required double amount,
    required String paymentType,
    String? walletId,
    String? depositAttachmentUrl,
    String? creditCustomerId,
    required bool isEmergencySale,
    double? emergencyOverridePrice,
    String? emergencyReason,
    required String soldAtIso,
    required Map<String, dynamic> payload,
  }) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);

      // فحص منع التكرار لنفس clientOpId
      final existingSale = await db.query(
        'sales',
        where: 'id = ?',
        whereArgs: [opId],
        limit: 1,
      );
      if (existingSale.isNotEmpty) {
        await AppDatabase.enqueueOperation(
          db,
          clientOpId: opId,
          opType: 'SALE',
          payload: payload,
        );
        _lastOperationQueuedOffline = true;
        await _loadOfflineTodaySales(storeOwnerId);
        _isLoading = false;
        notifyListeners();
        return true;
      }

      // فحص الصنف والمخزون المحلي
      final itemRows = await db.query(
        'items',
        where: 'id = ? AND deleted_at IS NULL',
        whereArgs: [itemId],
        limit: 1,
      );
      if (itemRows.isEmpty) {
        _errorCode = 'NOT_FOUND';
        _errorMessage = 'الصنف غير موجود في المخزون المحلي.';
        _isLoading = false;
        notifyListeners();
        return false;
      }
      final itemRow = itemRows.first;
      final unit = itemRow['unit']?.toString() ?? 'حبة';
      final availableQty = (itemRow['quantity'] as num?)?.toDouble() ?? 0.0;
      final sellPrice = (itemRow['sell_price'] as num?)?.toDouble() ?? 0.0;

      double effectiveQuantity = quantity;
      if (quantityUnit == 'GRAM') {
        if (!_isWeightUnit(unit)) {
          _errorCode = 'FRACTIONAL_GRAMS_NOT_ALLOWED';
          _errorMessage = 'لا يمكن استخدام الجرام مع صنف لا يُقاس بالوزن.';
          _isLoading = false;
          notifyListeners();
          return false;
        }
        if (_isKiloUnit(unit)) {
          effectiveQuantity = (quantity / 1000.0 * 1000).roundToDouble() / 1000.0;
        }
      } else if (!_isWeightUnit(unit) && (quantity - quantity.roundToDouble()).abs() > 1e-6) {
        _errorCode = 'VALIDATION_ERROR';
        _errorMessage = 'هذا الصنف يُباع بـ ($unit) ولا يقبل الكسور.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      if (effectiveQuantity > availableQty + 1e-6) {
        _errorCode = 'INSUFFICIENT_STOCK';
        _errorMessage = 'الكمية المتوفرة غير كافية.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      // فحص عميل الآجل وسقف الائتمان محلياً عند البيع بالآجل
      double? nextCustomerDebt;
      if (paymentType == 'CREDIT' && creditCustomerId != null) {
        final custRows = await db.query(
          'credit_customers',
          where: 'id = ?',
          whereArgs: [creditCustomerId],
          limit: 1,
        );
        if (custRows.isNotEmpty) {
          final cust = custRows.first;
          final currentDebt = (cust['total_debt'] as num?)?.toDouble() ?? 0.0;
          final creditLimit = (cust['credit_limit'] as num?)?.toDouble();
          if (creditLimit != null && (currentDebt + amount) > creditLimit + 0.005) {
            _errorCode = 'CREDIT_LIMIT_EXCEEDED';
            _errorMessage = 'تجاوز المبلغ سقف ائتمان العميل المسموح.';
            _isLoading = false;
            notifyListeners();
            return false;
          }
          nextCustomerDebt = currentDebt + amount;
        }
      }

      final unitPrice = isEmergencySale && emergencyOverridePrice != null
          ? emergencyOverridePrice
          : sellPrice;
      final priceDiffLoss = isEmergencySale && unitPrice < sellPrice
          ? ((sellPrice - unitPrice) * effectiveQuantity * 100).roundToDouble() / 100.0
          : 0.0;
      final nextItemQty =
          ((availableQty - effectiveQuantity) * 1000).roundToDouble() / 1000.0;

      await db.transaction((txn) async {
        await txn.update(
          'items',
          {'quantity': nextItemQty < 0 ? 0.0 : nextItemQty},
          where: 'id = ?',
          whereArgs: [itemId],
        );

        await txn.insert(
          'sales',
          {
            'id': opId,
            'client_op_id': opId,
            'item_id': itemId,
            'quantity': effectiveQuantity,
            'amount': amount,
            'payment_type': paymentType,
            'wallet_id': walletId,
            'deposit_attachment_url': depositAttachmentUrl,
            'credit_customer_id': creditCustomerId,
            'is_emergency_sale': isEmergencySale ? 1 : 0,
            'emergency_reason': isEmergencySale ? emergencyReason?.trim() : null,
            'emergency_override_price': isEmergencySale ? emergencyOverridePrice : null,
            'price_difference_loss': priceDiffLoss,
            'sold_at': soldAtIso,
            'synced': 0,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );

        if (paymentType == 'CREDIT' && creditCustomerId != null) {
          if (nextCustomerDebt != null) {
            await txn.update(
              'credit_customers',
              {'total_debt': nextCustomerDebt},
              where: 'id = ?',
              whereArgs: [creditCustomerId],
            );
          }
          await txn.insert(
            'credit_transactions',
            {
              'id': opId,
              'customer_id': creditCustomerId,
              'tx_type': 'CREDIT_SALE',
              'amount': amount,
              'notes': null,
              'created_at': soldAtIso,
            },
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
        }

        await AppDatabase.enqueueOperation(
          txn,
          clientOpId: opId,
          opType: 'SALE',
          payload: payload,
        );
      });

      _lastOperationQueuedOffline = true;
      await _loadOfflineTodaySales(storeOwnerId);
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

  Future<bool> processReturn({
    required String saleId,
    required double quantity,
    String? quantityUnit,
    required String reason,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.post(
        ApiEndpoints.returns,
        data: {
          'saleId': saleId,
          'quantity': quantity,
          if (quantityUnit != null) 'quantityUnit': quantityUnit,
          'reason': reason,
        },
      );
      await fetchTodaySales();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
