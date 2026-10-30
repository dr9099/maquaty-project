import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../data/local/app_database.dart';
import 'store_settings_provider.dart';

/// حاسبة تكلفة المشتريات المتوافقة مع طبيعة القات (صلاحية 24-48 ساعة)
/// تُستخدم محلياً للمعاينة الفورية وفي وضع عدم الاتصال والاختبارات الوحدوية
class CostingCalculator {
  /// فحص ما إذا كان هناك تعارض سعري لنفس الصنف في نفس اليوم مع وجود كمية متبقية > 0
  static bool hasSameDayPriceConflict({
    required double existingQty,
    required double existingCost,
    required DateTime existingEntryDate,
    required double newUnitCost,
    required DateTime invoiceDate,
  }) {
    final sameDay = existingEntryDate.year == invoiceDate.year &&
        existingEntryDate.month == invoiceDate.month &&
        existingEntryDate.day == invoiceDate.day;
    if (!sameDay) return false;
    if (existingQty <= 0.0) return false; // نافد -> يُعتمد السعر الجديد تلقائياً دون تعارض
    return (existingCost - newUnitCost).abs() >= 0.01;
  }

  /// حساب تكلفة الوحدة المعتمدة وفق الطرق الثلاث أو قاعدة اليوم الجديد/النفاد
  static double computeUpdatedUnitCost({
    required String method, // WEIGHTED_AVERAGE | LAST_PRICE | FIFO
    required double existingQty,
    required double existingCost,
    required DateTime existingEntryDate,
    required double addedBaseQty,
    required double newBaseUnitCost,
    required DateTime invoiceDate,
  }) {
    final sameDay = existingEntryDate.year == invoiceDate.year &&
        existingEntryDate.month == invoiceDate.month &&
        existingEntryDate.day == invoiceDate.day;

    // قاعدة القات (24-48 ساعة): يوم جديد أو مخزون صفر -> السعر الجديد مباشرة
    if (!sameDay || existingQty <= 0.0) {
      return _round2(newBaseUnitCost);
    }

    switch (method) {
      case 'LAST_PRICE':
        return _round2(newBaseUnitCost);
      case 'FIFO':
        // في FIFO يبقى سعر الطبقة الأقدم نشطاً حتى تنفد، ثم ينتقل تلقائياً للطبقة الأحدث
        return _round2(existingCost);
      case 'WEIGHTED_AVERAGE':
      default:
        final totalQty = existingQty + addedBaseQty;
        if (totalQty <= 0) return _round2(newBaseUnitCost);
        final avg = ((existingQty * existingCost) + (addedBaseQty * newBaseUnitCost)) / totalQty;
        return _round2(avg);
    }
  }

  /// حساب تكلفة البضاعة المباعة (COGS) بنظام الوارد أولاً صادر أولاً (FIFO)
  static double computeFifoCogs({
    required List<Map<String, double>> layers, // [{'qty': 10, 'cost': 4000}, ...]
    required double saleQty,
  }) {
    var remaining = saleQty;
    var totalCogs = 0.0;
    for (final layer in layers) {
      if (remaining <= 0) break;
      final available = layer['qty'] ?? 0.0;
      final cost = layer['cost'] ?? 0.0;
      if (available <= 0) continue;
      final consumed = remaining <= available ? remaining : available;
      totalCogs += consumed * cost;
      remaining -= consumed;
    }
    return _round2(totalCogs);
  }

  static double _round2(double v) => (v * 100).roundToDouble() / 100.0;
}

class PurchaseLineInput {
  final String? itemId;
  final String itemName;
  final String unit;
  final String baseUnit;
  final double conversionFactor;
  final double quantity;
  final double unitCostPrice;
  final double taxAmount;
  final double discountAmount;
  final double sellPrice;

  const PurchaseLineInput({
    this.itemId,
    required this.itemName,
    this.unit = 'حبة',
    this.baseUnit = 'حبة',
    this.conversionFactor = 1.0,
    required this.quantity,
    required this.unitCostPrice,
    this.taxAmount = 0.0,
    this.discountAmount = 0.0,
    required this.sellPrice,
  });

  double get baseQuantity => quantity * conversionFactor;
  double get lineTotal => (quantity * unitCostPrice) + taxAmount - discountAmount;
  double get effectiveBaseUnitCost =>
      baseQuantity > 0 ? lineTotal / baseQuantity : unitCostPrice;

  Map<String, dynamic> toApiJson() {
    return {
      if (itemId != null && itemId!.isNotEmpty) 'itemId': itemId,
      'itemName': itemName.trim(),
      'unit': unit.trim().isEmpty ? 'حبة' : unit.trim(),
      'baseUnit': baseUnit.trim().isEmpty ? 'حبة' : baseUnit.trim(),
      'conversionFactor': conversionFactor,
      'quantity': quantity,
      'unitCostPrice': unitCostPrice,
      if (taxAmount > 0) 'taxAmount': taxAmount,
      if (discountAmount > 0) 'discountAmount': discountAmount,
      'sellPrice': sellPrice,
    };
  }
}

class CostingConflictItem {
  final String itemName;
  final String baseUnit;
  final double existingQuantity;
  final double oldCostPrice;
  final double newQuantity;
  final double newCostPrice;
  final double weightedAveragePreview;

  const CostingConflictItem({
    required this.itemName,
    required this.baseUnit,
    required this.existingQuantity,
    required this.oldCostPrice,
    required this.newQuantity,
    required this.newCostPrice,
    required this.weightedAveragePreview,
  });

  factory CostingConflictItem.fromJson(Map<String, dynamic> json) {
    return CostingConflictItem(
      itemName: (json['item_name'] ?? '').toString(),
      baseUnit: (json['base_unit'] ?? json['unit'] ?? 'حبة').toString(),
      existingQuantity: (json['existing_quantity'] as num?)?.toDouble() ?? 0.0,
      oldCostPrice:
          ((json['old_cost_price'] ?? json['existing_cost_price']) as num?)
              ?.toDouble() ??
          0.0,
      newQuantity:
          ((json['new_quantity'] ?? json['incoming_quantity']) as num?)
              ?.toDouble() ??
          0.0,
      newCostPrice:
          ((json['new_cost_price'] ?? json['incoming_cost_price']) as num?)
              ?.toDouble() ??
          0.0,
      weightedAveragePreview:
          ((json['weighted_average_preview'] ?? json['weighted_average_cost'])
                  as num?)
              ?.toDouble() ??
          0.0,
    );
  }
}

class CostingPreviewResult {
  final bool hasSameDayPriceConflict;
  final String defaultCostingMethod;
  final String currencySymbol;
  final List<CostingOptionInfo> costingOptions;
  final List<CostingConflictItem> conflicts;

  const CostingPreviewResult({
    required this.hasSameDayPriceConflict,
    required this.defaultCostingMethod,
    required this.currencySymbol,
    required this.costingOptions,
    required this.conflicts,
  });

  factory CostingPreviewResult.fromJson(Map<String, dynamic> json) {
    final opts = (json['costing_options'] as List? ?? [])
        .map((e) => CostingOptionInfo.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    return CostingPreviewResult(
      hasSameDayPriceConflict: json['has_same_day_price_conflict'] == true,
      defaultCostingMethod:
          (json['default_costing_method'] ?? 'WEIGHTED_AVERAGE').toString(),
      currencySymbol: (json['currency_symbol'] ?? 'ر.ي').toString(),
      costingOptions: opts.isNotEmpty
          ? opts
          : StoreSettingsProvider.defaultCostingOptions,
      conflicts: (json['conflicts'] as List? ?? [])
          .map((e) => CostingConflictItem.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
    );
  }
}

class PurchaseItemModel {
  final String id;
  final String? itemId;
  final String itemName;
  final String baseUnit;
  final String unit;
  final double conversionFactor;
  final double quantity;
  final double baseQuantity;
  final double unitCostPrice;
  final double taxAmount;
  final double discountAmount;
  final double totalLineCost;
  final double effectiveBaseUnitCost;
  final double sellPrice;
  final double returnedQuantity;

  const PurchaseItemModel({
    required this.id,
    this.itemId,
    required this.itemName,
    required this.baseUnit,
    required this.unit,
    required this.conversionFactor,
    required this.quantity,
    required this.baseQuantity,
    required this.unitCostPrice,
    required this.taxAmount,
    required this.discountAmount,
    required this.totalLineCost,
    required this.effectiveBaseUnitCost,
    required this.sellPrice,
    required this.returnedQuantity,
  });

  double get remainingReturnableQty =>
      (quantity - returnedQuantity) > 0 ? (quantity - returnedQuantity) : 0.0;

  factory PurchaseItemModel.fromJson(Map<String, dynamic> json) {
    return PurchaseItemModel(
      id: (json['id'] ?? '').toString(),
      itemId: json['item_id']?.toString(),
      itemName: (json['item_name'] ?? '').toString(),
      baseUnit: (json['base_unit'] ?? 'حبة').toString(),
      unit: (json['unit'] ?? 'حبة').toString(),
      conversionFactor: (json['conversion_factor'] as num?)?.toDouble() ?? 1.0,
      quantity: (json['quantity'] as num?)?.toDouble() ?? 0.0,
      baseQuantity: (json['base_quantity'] as num?)?.toDouble() ?? 0.0,
      unitCostPrice: (json['unit_cost_price'] as num?)?.toDouble() ?? 0.0,
      taxAmount: (json['tax_amount'] as num?)?.toDouble() ?? 0.0,
      discountAmount: (json['discount_amount'] as num?)?.toDouble() ?? 0.0,
      totalLineCost: (json['total_line_cost'] as num?)?.toDouble() ?? 0.0,
      effectiveBaseUnitCost:
          (json['effective_base_unit_cost'] as num?)?.toDouble() ?? 0.0,
      sellPrice: (json['sell_price'] as num?)?.toDouble() ?? 0.0,
      returnedQuantity: (json['returned_quantity'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class PurchaseReturnModel {
  final String id;
  final String purchaseItemId;
  final String itemName;
  final double quantity;
  final double totalAmount;
  final String refundMethod;
  final String reason;
  final String returnedAt;

  const PurchaseReturnModel({
    required this.id,
    required this.purchaseItemId,
    required this.itemName,
    required this.quantity,
    required this.totalAmount,
    required this.refundMethod,
    required this.reason,
    required this.returnedAt,
  });

  factory PurchaseReturnModel.fromJson(Map<String, dynamic> json) {
    return PurchaseReturnModel(
      id: (json['id'] ?? '').toString(),
      purchaseItemId: (json['purchase_item_id'] ?? '').toString(),
      itemName: (json['item_name'] ?? '').toString(),
      quantity: (json['quantity'] as num?)?.toDouble() ?? 0.0,
      totalAmount: (json['total_amount'] as num?)?.toDouble() ?? 0.0,
      refundMethod: (json['refund_method'] ?? 'DEBT_REDUCTION').toString(),
      reason: (json['reason'] ?? '').toString(),
      returnedAt: (json['returned_at'] ?? '').toString(),
    );
  }
}

class PurchaseInvoiceModel {
  final String id;
  final String invoiceNumber;
  final String? supplierInvoiceRef;
  final String invoiceDate;
  final String? dueDate;
  final String supplierId;
  final String supplierName;
  final String? supplierPhone;
  final String paymentType; // CASH | ELECTRONIC | CREDIT | PARTIAL
  final String? walletName;
  final double subtotal;
  final double taxAmount;
  final double discountAmount;
  final double totalAmount;
  final double paidAmount;
  final double settledAmount;
  final double remainingAmount;
  final String currency;
  final String currencySymbol;
  final String? attachmentUrl;
  final String? notes;
  final String status; // DRAFT | POSTED | VOIDED
  final String? costingMethodUsed;
  final String? voidReason;
  final int itemsCount;
  final List<PurchaseItemModel> items;
  final List<PurchaseReturnModel> returns;

  const PurchaseInvoiceModel({
    required this.id,
    required this.invoiceNumber,
    this.supplierInvoiceRef,
    required this.invoiceDate,
    this.dueDate,
    required this.supplierId,
    required this.supplierName,
    this.supplierPhone,
    required this.paymentType,
    this.walletName,
    required this.subtotal,
    required this.taxAmount,
    required this.discountAmount,
    required this.totalAmount,
    required this.paidAmount,
    required this.settledAmount,
    required this.remainingAmount,
    this.currency = 'YER',
    this.currencySymbol = 'ر.ي',
    this.attachmentUrl,
    this.notes,
    required this.status,
    this.costingMethodUsed,
    this.voidReason,
    this.itemsCount = 0,
    this.items = const [],
    this.returns = const [],
  });

  bool get isDraft => status == 'DRAFT';
  bool get isPosted => status == 'POSTED';
  bool get isVoided => status == 'VOIDED';

  static String paymentTypeLabelAr(String pt) {
    switch (pt) {
      case 'CASH':
        return 'نقدي';
      case 'ELECTRONIC':
        return 'محفظة إلكترونية';
      case 'CREDIT':
        return 'آجل (على الحساب)';
      case 'PARTIAL':
        return 'دفع جزئي';
      default:
        return pt;
    }
  }

  static String statusLabelAr(String st) {
    switch (st) {
      case 'DRAFT':
        return 'مسودة';
      case 'POSTED':
        return 'معتمدة';
      case 'VOIDED':
        return 'ملغاة';
      default:
        return st;
    }
  }

  factory PurchaseInvoiceModel.fromJson(Map<String, dynamic> json) {
    final sup = Map<String, dynamic>.from(json['supplier'] ?? {});
    final wal = json['wallet'] is Map
        ? Map<String, dynamic>.from(json['wallet'])
        : null;
    final itemsList = (json['items'] as List? ?? [])
        .map((e) => PurchaseItemModel.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    final returnsList = (json['returns'] as List? ?? [])
        .map((e) => PurchaseReturnModel.fromJson(Map<String, dynamic>.from(e)))
        .toList();

    return PurchaseInvoiceModel(
      id: (json['id'] ?? '').toString(),
      invoiceNumber: (json['invoice_number'] ?? '').toString(),
      supplierInvoiceRef: json['supplier_invoice_ref']?.toString(),
      invoiceDate: (json['invoice_date'] ?? '').toString(),
      dueDate: json['due_date']?.toString(),
      supplierId: (sup['id'] ?? json['supplier_id'] ?? '').toString(),
      supplierName: (sup['name'] ?? json['supplier_name'] ?? 'مورد').toString(),
      supplierPhone: sup['phone']?.toString(),
      paymentType: (json['payment_type'] ?? 'CASH').toString(),
      walletName: wal?['name']?.toString(),
      subtotal: (json['subtotal'] as num?)?.toDouble() ?? 0.0,
      taxAmount: (json['tax_amount'] as num?)?.toDouble() ?? 0.0,
      discountAmount: (json['discount_amount'] as num?)?.toDouble() ?? 0.0,
      totalAmount: (json['total_amount'] as num?)?.toDouble() ?? 0.0,
      paidAmount: (json['paid_amount'] as num?)?.toDouble() ?? 0.0,
      settledAmount: (json['settled_amount'] as num?)?.toDouble() ?? 0.0,
      remainingAmount: (json['remaining_amount'] as num?)?.toDouble() ?? 0.0,
      currency: (json['currency'] ?? 'YER').toString(),
      currencySymbol: (json['currency_symbol'] ?? 'ر.ي').toString(),
      attachmentUrl: json['attachment_url']?.toString(),
      notes: json['notes']?.toString(),
      status: (json['status'] ?? 'POSTED').toString(),
      costingMethodUsed: json['costing_method_used']?.toString(),
      voidReason: json['void_reason']?.toString(),
      itemsCount: (json['items_count'] as num?)?.toInt() ?? itemsList.length,
      items: itemsList,
      returns: returnsList,
    );
  }
}

/// مزود إدارة فواتير المشتريات وفحص التكلفة ومرتجعات الشراء (حصري لمالك المتجر)
class PurchasesProvider with ChangeNotifier {
  static const int maxInvoiceLines = 200;

  final ApiClient _api;
  final _uuid = const Uuid();

  List<PurchaseInvoiceModel> _purchases = [];
  int _totalCount = 0;
  double _summaryTotal = 0.0;
  double _summaryPaid = 0.0;
  double _summaryRemaining = 0.0;
  String _currencySymbol = 'ر.ي';
  bool _isLoading = false;
  String? _errorMessage;
  String? _errorCode;
  dynamic _errorDetails;

  PurchasesProvider(this._api);

  List<PurchaseInvoiceModel> get purchases => _purchases;
  int get totalCount => _totalCount;
  double get summaryTotal => _summaryTotal;
  double get summaryPaid => _summaryPaid;
  double get summaryRemaining => _summaryRemaining;
  String get currencySymbol => _currencySymbol;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get errorCode => _errorCode;
  dynamic get errorDetails => _errorDetails;

  Future<void> fetchPurchases({
    String? supplierId,
    String? status,
    String? paymentType,
    String? search,
    String? dateFrom,
    String? dateTo,
    int limit = 25,
    int offset = 0,
    String? storeOwnerId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      final res = await _api.get(
        ApiEndpoints.purchases,
        queryParameters: {
          'limit': limit,
          'offset': offset,
          if (supplierId != null && supplierId.isNotEmpty) 'supplier_id': supplierId,
          if (status != null && status.isNotEmpty) 'status': status,
          if (paymentType != null && paymentType.isNotEmpty) 'payment_type': paymentType,
          if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
          if (dateFrom != null && dateFrom.isNotEmpty) 'date_from': dateFrom,
          if (dateTo != null && dateTo.isNotEmpty) 'date_to': dateTo,
        },
      );
      final data = Map<String, dynamic>.from(res.data);
      final sum = Map<String, dynamic>.from(data['summary'] ?? {});
      _purchases = (data['items'] as List? ?? [])
          .map((e) => PurchaseInvoiceModel.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      _totalCount = (data['total'] as num?)?.toInt() ?? _purchases.length;
      _summaryTotal = (sum['total_amount'] as num?)?.toDouble() ?? 0.0;
      _summaryPaid = (sum['paid_amount'] as num?)?.toDouble() ?? 0.0;
      _summaryRemaining = (sum['remaining_amount'] as num?)?.toDouble() ?? 0.0;
      _currencySymbol = (data['currency_symbol'] ?? _currencySymbol).toString();
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        await _loadOfflinePurchases(storeOwnerId);
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

  Future<void> _loadOfflinePurchases(String storeOwnerId) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      final rows = await db.query('purchase_invoices', orderBy: 'created_at DESC');
      _purchases = rows.map((r) => PurchaseInvoiceModel.fromJson(r)).toList();
      _totalCount = _purchases.length;
      _summaryTotal = _purchases.fold(0.0, (s, p) => s + p.totalAmount);
      _summaryPaid = _purchases.fold(0.0, (s, p) => s + p.paidAmount);
      _summaryRemaining = _purchases.fold(0.0, (s, p) => s + p.remainingAmount);
    } catch (_) {}
  }

  Future<PurchaseInvoiceModel?> fetchPurchaseById(String id) async {
    _errorMessage = null;
    _errorCode = null;
    try {
      final res = await _api.get(ApiEndpoints.purchaseById(id));
      return PurchaseInvoiceModel.fromJson(Map<String, dynamic>.from(res.data));
    } on ApiException catch (e) {
      _errorCode = e.code;
      _errorMessage = e.message;
      notifyListeners();
      return null;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<CostingPreviewResult?> previewCosting({
    String? invoiceDate,
    double taxAmount = 0.0,
    double discountAmount = 0.0,
    required List<PurchaseLineInput> items,
  }) async {
    try {
      final res = await _api.post(
        ApiEndpoints.purchasePreviewCosting,
        data: {
          if (invoiceDate != null && invoiceDate.isNotEmpty) 'invoiceDate': invoiceDate,
          if (taxAmount > 0) 'taxAmount': taxAmount,
          if (discountAmount > 0) 'discountAmount': discountAmount,
          'items': items.map((e) => e.toApiJson()).toList(),
        },
      );
      return CostingPreviewResult.fromJson(Map<String, dynamic>.from(res.data));
    } catch (_) {
      return null;
    }
  }

  Future<PurchaseInvoiceModel?> createPurchase({
    required String supplierId,
    String? supplierNameForOffline,
    String? supplierInvoiceRef,
    String? invoiceDate,
    String? dueDate,
    required String paymentType,
    String? walletId,
    double taxAmount = 0.0,
    double discountAmount = 0.0,
    double? paidAmount,
    String? attachmentUrl,
    String? notes,
    String status = 'POSTED', // DRAFT | POSTED
    String? costingMethod,
    bool promptOnSameDayPriceDiff = false,
    required List<PurchaseLineInput> items,
    String? storeOwnerId,
  }) async {
    if (items.length > maxInvoiceLines) {
      _errorCode = 'INVOICE_LINES_LIMIT_EXCEEDED';
      _errorMessage = 'الحد الأقصى لبنود الفاتورة الواحدة هو $maxInvoiceLines بند.';
      notifyListeners();
      return null;
    }

    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    _errorDetails = null;
    notifyListeners();

    final invoiceId = _uuid.v4();
    final payload = <String, dynamic>{
      'id': invoiceId,
      'supplierId': supplierId,
      if (supplierInvoiceRef != null && supplierInvoiceRef.trim().isNotEmpty)
        'supplierInvoiceRef': supplierInvoiceRef.trim(),
      if (invoiceDate != null && invoiceDate.isNotEmpty) 'invoiceDate': invoiceDate,
      if (dueDate != null && dueDate.isNotEmpty) 'dueDate': dueDate,
      'paymentType': paymentType,
      if (walletId != null && walletId.isNotEmpty) 'walletId': walletId,
      if (taxAmount > 0) 'taxAmount': taxAmount,
      if (discountAmount > 0) 'discountAmount': discountAmount,
      if (paidAmount != null) 'paidAmount': paidAmount,
      if (attachmentUrl != null && attachmentUrl.isNotEmpty)
        'attachmentUrl': attachmentUrl,
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      'status': status,
      if (costingMethod != null && costingMethod.isNotEmpty)
        'costingMethod': costingMethod,
      if (promptOnSameDayPriceDiff) 'promptOnSameDayPriceDiff': true,
      'items': items.map((e) => e.toApiJson()).toList(),
    };

    try {
      final res = await _api.post(ApiEndpoints.purchases, data: payload);
      final created = PurchaseInvoiceModel.fromJson(Map<String, dynamic>.from(res.data));
      await fetchPurchases(storeOwnerId: storeOwnerId);
      return created;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' &&
          status == 'POSTED' &&
          storeOwnerId != null &&
          storeOwnerId.isNotEmpty) {
        // حفظ محلي في SQLite وإدراج في طابور المزامنة Offline Queue
        final db = await AppDatabase.getInstance(storeOwnerId);
        final subtotal = items.fold(0.0, (s, l) => s + l.lineTotal);
        final total = subtotal + taxAmount - discountAmount;
        final paid = paymentType == 'CREDIT'
            ? 0.0
            : (paymentType == 'PARTIAL' ? (paidAmount ?? 0.0) : total);
        final remaining = (total - paid) > 0 ? (total - paid) : 0.0;
        final nowIso = DateTime.now().toIso8601String();
        final offlineInvNo = 'OFF-${invoiceId.substring(0, 6).toUpperCase()}';

        await db.insert('purchase_invoices', {
          'id': invoiceId,
          'client_op_id': invoiceId,
          'supplier_id': supplierId,
          'supplier_name': supplierNameForOffline ?? 'مورد',
          'invoice_number': offlineInvNo,
          'supplier_invoice_ref': supplierInvoiceRef,
          'invoice_date': invoiceDate ?? nowIso,
          'due_date': dueDate,
          'payment_type': paymentType,
          'wallet_id': walletId,
          'subtotal': subtotal,
          'tax_amount': taxAmount,
          'discount_amount': discountAmount,
          'total_amount': total,
          'paid_amount': paid,
          'remaining_amount': remaining,
          'currency': 'YER',
          'attachment_url': attachmentUrl,
          'notes': notes,
          'status': 'POSTED',
          'costing_method_used': costingMethod ?? 'WEIGHTED_AVERAGE',
          'created_at': nowIso,
          'synced': 0,
        });

        await AppDatabase.enqueueOperation(
          db,
          clientOpId: _uuid.v4(),
          opType: 'PURCHASE',
          payload: payload,
        );

        await _loadOfflinePurchases(storeOwnerId);
        _isLoading = false;
        notifyListeners();
        return PurchaseInvoiceModel(
          id: invoiceId,
          invoiceNumber: offlineInvNo,
          invoiceDate: invoiceDate ?? nowIso,
          supplierId: supplierId,
          supplierName: supplierNameForOffline ?? 'مورد',
          paymentType: paymentType,
          subtotal: subtotal,
          taxAmount: taxAmount,
          discountAmount: discountAmount,
          totalAmount: total,
          paidAmount: paid,
          settledAmount: 0,
          remainingAmount: remaining,
          status: 'POSTED',
        );
      }
      _errorCode = e.code;
      _errorMessage = e.message;
      _errorDetails = e.details;
      _isLoading = false;
      notifyListeners();
      return null;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return null;
    }
  }

  Future<PurchaseInvoiceModel?> postDraft(
    String id, {
    String? costingMethod,
    bool promptOnSameDayPriceDiff = false,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    _errorDetails = null;
    notifyListeners();

    try {
      final res = await _api.post(
        ApiEndpoints.purchasePost(id),
        data: {
          if (costingMethod != null && costingMethod.isNotEmpty)
            'costingMethod': costingMethod,
          if (promptOnSameDayPriceDiff) 'promptOnSameDayPriceDiff': true,
        },
      );
      final posted = PurchaseInvoiceModel.fromJson(Map<String, dynamic>.from(res.data));
      await fetchPurchases();
      return posted;
    } on ApiException catch (e) {
      _errorCode = e.code;
      _errorMessage = e.message;
      _errorDetails = e.details;
      _isLoading = false;
      notifyListeners();
      return null;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return null;
    }
  }

  Future<bool> voidInvoice(String id, {required String reason}) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      await _api.post(ApiEndpoints.purchaseVoid(id), data: {'reason': reason.trim()});
      await fetchPurchases();
      return true;
    } on ApiException catch (e) {
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

  Future<bool> createReturn({
    required String invoiceId,
    required String purchaseItemId,
    required double quantity,
    required String refundMethod, // DEBT_REDUCTION | CASH_REFUND
    required String reason,
    String? storeOwnerId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    final returnId = _uuid.v4();
    final payload = <String, dynamic>{
      'id': returnId,
      'purchaseItemId': purchaseItemId,
      'quantity': quantity,
      'refundMethod': refundMethod,
      'reason': reason.trim(),
    };

    try {
      await _api.post(ApiEndpoints.purchaseReturns(invoiceId), data: payload);
      await fetchPurchases(storeOwnerId: storeOwnerId);
      return true;
    } on ApiException catch (e) {
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
}

