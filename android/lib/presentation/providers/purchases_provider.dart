import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../core/utils/quantity_formatter.dart';
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
  final String? id;
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
    this.id,
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
      if (id != null && id!.isNotEmpty) 'id': id,
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
  final String? quantityDisplay;
  final double baseQuantity;
  final double unitCostPrice;
  final double taxAmount;
  final double discountAmount;
  final double totalLineCost;
  final double effectiveBaseUnitCost;
  final double sellPrice;
  final double returnedQuantity;
  final String? returnedQuantityDisplay;

  const PurchaseItemModel({
    required this.id,
    this.itemId,
    required this.itemName,
    required this.baseUnit,
    required this.unit,
    required this.conversionFactor,
    required this.quantity,
    this.quantityDisplay,
    required this.baseQuantity,
    required this.unitCostPrice,
    required this.taxAmount,
    required this.discountAmount,
    required this.totalLineCost,
    required this.effectiveBaseUnitCost,
    required this.sellPrice,
    required this.returnedQuantity,
    this.returnedQuantityDisplay,
  });

  String get displayQuantity =>
      quantityDisplay ?? formatQuantityDisplay(baseQuantity, unit: baseUnit);

  String get displayReturnedQuantity =>
      returnedQuantityDisplay ??
      formatQuantityDisplay(returnedQuantity * conversionFactor, unit: baseUnit);

  double get remainingReturnableQty =>
      (quantity - returnedQuantity) > 0 ? (quantity - returnedQuantity) : 0.0;

  factory PurchaseItemModel.fromJson(Map<String, dynamic> json) {
    final bUnit = (json['base_unit'] ?? 'حبة').toString();
    final factor = (json['conversion_factor'] as num?)?.toDouble() ?? 1.0;
    final qty = (json['quantity'] as num?)?.toDouble() ?? 0.0;
    final bQty = (json['base_quantity'] as num?)?.toDouble() ?? (qty * factor);
    final retQty = (json['returned_quantity'] as num?)?.toDouble() ?? 0.0;

    return PurchaseItemModel(
      id: (json['id'] ?? '').toString(),
      itemId: json['item_id']?.toString(),
      itemName: (json['item_name'] ?? '').toString(),
      baseUnit: bUnit,
      unit: (json['unit'] ?? 'حبة').toString(),
      conversionFactor: factor,
      quantity: qty,
      quantityDisplay: json['quantity_display'] ?? formatQuantityDisplay(bQty, unit: bUnit),
      baseQuantity: bQty,
      unitCostPrice: (json['unit_cost_price'] as num?)?.toDouble() ?? 0.0,
      taxAmount: (json['tax_amount'] as num?)?.toDouble() ?? 0.0,
      discountAmount: (json['discount_amount'] as num?)?.toDouble() ?? 0.0,
      totalLineCost: (json['total_line_cost'] as num?)?.toDouble() ?? 0.0,
      effectiveBaseUnitCost:
          (json['effective_base_unit_cost'] as num?)?.toDouble() ?? 0.0,
      sellPrice: (json['sell_price'] as num?)?.toDouble() ?? 0.0,
      returnedQuantity: retQty,
      returnedQuantityDisplay: json['returned_quantity_display'] ??
          formatQuantityDisplay(retQty * factor, unit: bUnit),
    );
  }
}

class PurchaseReturnModel {
  final String id;
  final String purchaseItemId;
  final String itemName;
  final double quantity;
  final String? quantityDisplay;
  final double totalAmount;
  final String refundMethod;
  final String reason;
  final String returnedAt;
  final String unit;

  const PurchaseReturnModel({
    required this.id,
    required this.purchaseItemId,
    required this.itemName,
    required this.quantity,
    this.quantityDisplay,
    required this.totalAmount,
    required this.refundMethod,
    required this.reason,
    required this.returnedAt,
    this.unit = 'حبة',
  });

  String get displayQuantity =>
      quantityDisplay ?? formatQuantityDisplay(quantity, unit: unit);

  factory PurchaseReturnModel.fromJson(Map<String, dynamic> json) {
    final qty = (json['quantity'] as num?)?.toDouble() ?? 0.0;
    final unitVal = (json['unit'] ??
            json['item_unit'] ??
            json['item']?['unit'] ??
            'حبة')
        .toString();
    return PurchaseReturnModel(
      id: (json['id'] ?? '').toString(),
      purchaseItemId: (json['purchase_item_id'] ?? '').toString(),
      itemName: (json['item_name'] ?? '').toString(),
      quantity: qty,
      quantityDisplay: json['quantity_display'] ??
          formatQuantityDisplay(qty, unit: unitVal),
      totalAmount: (json['total_amount'] as num?)?.toDouble() ?? 0.0,
      refundMethod: (json['refund_method'] ?? 'DEBT_REDUCTION').toString(),
      reason: (json['reason'] ?? '').toString(),
      returnedAt: (json['returned_at'] ?? '').toString(),
      unit: unitVal,
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
      final savedCurrency =
          await AppDatabase.getStoreSetting(db, 'currency') ?? 'YER';
      final savedSymbol =
          await AppDatabase.getStoreSetting(db, 'currency_symbol') ?? 'ر.ي';
      _currencySymbol = savedSymbol;

      final rows = await db.query('purchase_invoices', orderBy: 'created_at DESC');
      final itemRows = await db.query('purchase_items');
      final returnRows = await db.query('purchase_returns', orderBy: 'returned_at DESC');

      final itemsByInvoice = <String, List<Map<String, dynamic>>>{};
      final itemNameByPurchaseItemId = <String, String>{};
      for (final ir in itemRows) {
        final invId = ir['purchase_invoice_id']?.toString() ?? '';
        final pItemId = ir['id']?.toString() ?? '';
        final pItemName = ir['item_name']?.toString() ?? '';
        if (pItemId.isNotEmpty) {
          itemNameByPurchaseItemId[pItemId] = pItemName;
        }
        itemsByInvoice.putIfAbsent(invId, () => []).add(ir);
      }

      final returnsByInvoice = <String, List<Map<String, dynamic>>>{};
      for (final rr in returnRows) {
        final invId = rr['purchase_invoice_id']?.toString() ?? '';
        final pItemId = rr['purchase_item_id']?.toString() ?? '';
        returnsByInvoice.putIfAbsent(invId, () => []).add({
          ...rr,
          'item_name': rr['item_name'] ?? itemNameByPurchaseItemId[pItemId] ?? 'صنف',
        });
      }

      _purchases = rows.map((r) {
        final invId = r['id']?.toString() ?? '';
        final invItems = itemsByInvoice[invId] ?? const [];
        final invReturns = returnsByInvoice[invId] ?? const [];
        return PurchaseInvoiceModel.fromJson({
          ...r,
          'currency': r['currency'] ?? savedCurrency,
          'currency_symbol': savedSymbol,
          'items_count': invItems.length,
          'items': invItems,
          'returns': invReturns,
        });
      }).toList();
      _totalCount = _purchases.length;
      _summaryTotal = _purchases.fold(0.0, (s, p) => s + p.totalAmount);
      _summaryPaid = _purchases.fold(0.0, (s, p) => s + p.paidAmount);
      _summaryRemaining = _purchases.fold(0.0, (s, p) => s + p.remainingAmount);
    } catch (_) {}
  }

  Future<PurchaseInvoiceModel?> fetchPurchaseById(
    String id, {
    String? storeOwnerId,
  }) async {
    _errorMessage = null;
    _errorCode = null;
    try {
      final res = await _api.get(ApiEndpoints.purchaseById(id));
      final detail = PurchaseInvoiceModel.fromJson(Map<String, dynamic>.from(res.data));
      if (storeOwnerId != null && storeOwnerId.isNotEmpty) {
        await _cacheOnlinePurchaseDetail(storeOwnerId, detail);
      }
      return detail;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        return await _loadOfflinePurchaseById(storeOwnerId, id);
      }
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

  Future<void> _cacheOnlinePurchaseDetail(
    String storeOwnerId,
    PurchaseInvoiceModel detail,
  ) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      await db.transaction((txn) async {
        await txn.insert(
          'purchase_invoices',
          {
            'id': detail.id,
            'invoice_number': detail.invoiceNumber,
            'supplier_invoice_ref': detail.supplierInvoiceRef,
            'supplier_id': detail.supplierId,
            'supplier_name': detail.supplierName,
            'invoice_date': detail.invoiceDate,
            'due_date': detail.dueDate,
            'payment_type': detail.paymentType,
            'subtotal': detail.subtotal,
            'tax_amount': detail.taxAmount,
            'discount_amount': detail.discountAmount,
            'total_amount': detail.totalAmount,
            'paid_amount': detail.paidAmount,
            'remaining_amount': detail.remainingAmount,
            'currency': detail.currency,
            'status': detail.status,
            'costing_method_used': detail.costingMethodUsed ?? 'WEIGHTED_AVERAGE',
            'attachment_url': detail.attachmentUrl,
            'notes': detail.notes,
            'synced': 1,
            'created_at': detail.invoiceDate,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
        for (final line in detail.items) {
          await txn.insert(
            'purchase_items',
            {
              'id': line.id,
              'purchase_invoice_id': detail.id,
              'item_id': line.itemId,
              'item_name': line.itemName,
              'base_unit': line.baseUnit,
              'unit': line.unit,
              'conversion_factor': line.conversionFactor,
              'quantity': line.quantity,
              'base_quantity': line.baseQuantity,
              'unit_cost_price': line.unitCostPrice,
              'tax_amount': line.taxAmount,
              'discount_amount': line.discountAmount,
              'total_line_cost': line.totalLineCost,
              'sell_price': line.sellPrice,
              'returned_quantity': line.returnedQuantity,
            },
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
        }
      });
    } catch (_) {}
  }

  Future<PurchaseInvoiceModel?> _loadOfflinePurchaseById(
    String storeOwnerId,
    String invoiceId,
  ) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      final savedCurrency =
          await AppDatabase.getStoreSetting(db, 'currency') ?? 'YER';
      final savedSymbol =
          await AppDatabase.getStoreSetting(db, 'currency_symbol') ?? 'ر.ي';

      final invRows = await db.query(
        'purchase_invoices',
        where: 'id = ?',
        whereArgs: [invoiceId],
        limit: 1,
      );
      if (invRows.isEmpty) return null;

      final itemRows = await db.query(
        'purchase_items',
        where: 'purchase_invoice_id = ?',
        whereArgs: [invoiceId],
      );
      final itemNames = <String, String>{};
      for (final ir in itemRows) {
        final id = ir['id']?.toString() ?? '';
        if (id.isNotEmpty) {
          itemNames[id] = ir['item_name']?.toString() ?? 'صنف';
        }
      }

      final returnRows = await db.query(
        'purchase_returns',
        where: 'purchase_invoice_id = ?',
        whereArgs: [invoiceId],
        orderBy: 'returned_at DESC',
      );
      final enrichedReturns = returnRows
          .map((rr) => {
                ...rr,
                'item_name':
                    rr['item_name'] ?? itemNames[rr['purchase_item_id']?.toString() ?? ''] ?? 'صنف',
              })
          .toList();

      return PurchaseInvoiceModel.fromJson({
        ...invRows.first,
        'currency': invRows.first['currency'] ?? savedCurrency,
        'currency_symbol': savedSymbol,
        'items_count': itemRows.length,
        'items': itemRows,
        'returns': enrichedReturns,
      });
    } catch (_) {
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
    String? invoiceId,
    String? clientOpId,
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

    final resolvedInvoiceId =
        (invoiceId != null && invoiceId.trim().isNotEmpty) ? invoiceId.trim() : _uuid.v4();
    final resolvedClientOpId =
        (clientOpId != null && clientOpId.trim().isNotEmpty) ? clientOpId.trim() : _uuid.v4();

    final normalizedLines = items.map((line) {
      final lineId = (line.id != null && line.id!.trim().isNotEmpty)
          ? line.id!.trim()
          : _uuid.v4();
      return PurchaseLineInput(
        id: lineId,
        itemId: line.itemId,
        itemName: line.itemName,
        unit: line.unit,
        baseUnit: line.baseUnit,
        conversionFactor: line.conversionFactor,
        quantity: line.quantity,
        unitCostPrice: line.unitCostPrice,
        taxAmount: line.taxAmount,
        discountAmount: line.discountAmount,
        sellPrice: line.sellPrice,
      );
    }).toList();

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
      'id': resolvedInvoiceId,
      'clientOpId': resolvedClientOpId,
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
      if (finalAttachmentUrl != null && finalAttachmentUrl.isNotEmpty)
        'attachmentUrl': finalAttachmentUrl,
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      'status': status,
      if (costingMethod != null && costingMethod.isNotEmpty)
        'costingMethod': costingMethod,
      if (promptOnSameDayPriceDiff) 'promptOnSameDayPriceDiff': true,
      'items': normalizedLines.map((e) => e.toApiJson()).toList(),
    };

    try {
      final res = await _api.post(ApiEndpoints.purchases, data: payload);
      final created = PurchaseInvoiceModel.fromJson(Map<String, dynamic>.from(res.data));
      if (storeOwnerId != null && storeOwnerId.isNotEmpty) {
        await _cacheOnlinePurchaseDetail(storeOwnerId, created);
      }
      await fetchPurchases(storeOwnerId: storeOwnerId);
      return created;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' &&
          status == 'POSTED' &&
          storeOwnerId != null &&
          storeOwnerId.isNotEmpty) {
        // حفظ محلي متكامل في SQLite (فاتورة + بنود + تحديث المخزون + ذمة المورد) وإدراج في طابور المزامنة
        final db = await AppDatabase.getInstance(storeOwnerId);
        final savedCurrency =
            await AppDatabase.getStoreSetting(db, 'currency') ?? 'YER';
        final savedSymbol =
            await AppDatabase.getStoreSetting(db, 'currency_symbol') ?? 'ر.ي';
        final subtotal = normalizedLines.fold(0.0, (s, l) => s + l.lineTotal);
        final total = subtotal + taxAmount - discountAmount;
        final paid = paymentType == 'CREDIT'
            ? 0.0
            : (paymentType == 'PARTIAL' ? (paidAmount ?? 0.0) : total);
        final remaining = (total - paid) > 0 ? (total - paid) : 0.0;
        final nowIso = DateTime.now().toIso8601String();
        final offlineInvNo = 'OFF-${resolvedInvoiceId.substring(0, 6).toUpperCase()}';
        final resolvedMethod = costingMethod ?? 'WEIGHTED_AVERAGE';

        // فحص منع التكرار لنفس الفاتورة أو العملية
        final existingInv = await db.query(
          'purchase_invoices',
          where: 'id = ? OR client_op_id = ?',
          whereArgs: [resolvedInvoiceId, resolvedClientOpId],
          limit: 1,
        );

        final localItemModels = <PurchaseItemModel>[];

        if (existingInv.isEmpty) {
          await db.transaction((txn) async {
            await txn.insert(
              'purchase_invoices',
              {
                'id': resolvedInvoiceId,
                'client_op_id': resolvedClientOpId,
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
                'currency': savedCurrency,
                'attachment_url': attachmentUrl,
                'notes': notes,
                'status': 'POSTED',
                'costing_method_used': resolvedMethod,
                'created_at': nowIso,
                'synced': 0,
              },
              conflictAlgorithm: ConflictAlgorithm.replace,
            );

            for (final line in normalizedLines) {
              final lineId = line.id!;
              var resolvedItemId =
                  (line.itemId != null && line.itemId!.trim().isNotEmpty)
                      ? line.itemId!.trim()
                      : null;
              final baseUnit =
                  line.baseUnit.trim().isEmpty ? line.unit.trim() : line.baseUnit.trim();
              final addedBaseQty =
                  (line.baseQuantity * 1000).roundToDouble() / 1000.0;
              final effectiveCost =
                  (line.effectiveBaseUnitCost * 100).roundToDouble() / 100.0;

              // تحديث المخزون المحلي (أو إنشاء الصنف محلياً)
              Map<String, dynamic>? existingItem;
              if (resolvedItemId != null) {
                final byId = await txn.query(
                  'items',
                  where: 'id = ? AND deleted_at IS NULL',
                  whereArgs: [resolvedItemId],
                  limit: 1,
                );
                if (byId.isNotEmpty) existingItem = byId.first;
              }
              if (existingItem == null) {
                final byName = await txn.query(
                  'items',
                  where: 'LOWER(name) = ? AND deleted_at IS NULL',
                  whereArgs: [line.itemName.trim().toLowerCase()],
                  limit: 1,
                );
                if (byName.isNotEmpty) {
                  existingItem = byName.first;
                  resolvedItemId = existingItem['id']?.toString();
                }
              }

              if (existingItem != null && resolvedItemId != null) {
                final currentQty =
                    (existingItem['quantity'] as num?)?.toDouble() ?? 0.0;
                final currentCost =
                    (existingItem['cost_price'] as num?)?.toDouble() ?? effectiveCost;
                final nextQty =
                    ((currentQty + addedBaseQty) * 1000).roundToDouble() / 1000.0;
                final nextCost = CostingCalculator.computeUpdatedUnitCost(
                  method: resolvedMethod,
                  existingQty: currentQty,
                  existingCost: currentCost,
                  existingEntryDate: DateTime.now(),
                  addedBaseQty: addedBaseQty,
                  newBaseUnitCost: effectiveCost,
                  invoiceDate: DateTime.now(),
                );
                await txn.update(
                  'items',
                  {
                    'quantity': nextQty,
                    'cost_price': nextCost,
                    'sell_price': line.sellPrice,
                  },
                  where: 'id = ?',
                  whereArgs: [resolvedItemId],
                );
              } else {
                resolvedItemId ??= _uuid.v4();
                await txn.insert(
                  'items',
                  {
                    'id': resolvedItemId,
                    'name': line.itemName.trim(),
                    'unit': baseUnit.isEmpty ? 'حبة' : baseUnit,
                    'quantity': addedBaseQty,
                    'sell_price': line.sellPrice,
                    'cost_price': effectiveCost,
                    'emergency_price_mode': 'RANGE_OR_OPEN',
                    'deleted_at': null,
                  },
                  conflictAlgorithm: ConflictAlgorithm.replace,
                );
              }

              await txn.insert(
                'purchase_items',
                {
                  'id': lineId,
                  'purchase_invoice_id': resolvedInvoiceId,
                  'item_id': resolvedItemId,
                  'item_name': line.itemName.trim(),
                  'base_unit': baseUnit.isEmpty ? 'حبة' : baseUnit,
                  'unit': line.unit.trim().isEmpty ? 'حبة' : line.unit.trim(),
                  'conversion_factor': line.conversionFactor,
                  'quantity': line.quantity,
                  'base_quantity': addedBaseQty,
                  'unit_cost_price': line.unitCostPrice,
                  'tax_amount': line.taxAmount,
                  'discount_amount': line.discountAmount,
                  'total_line_cost': line.lineTotal,
                  'sell_price': line.sellPrice,
                  'returned_quantity': 0.0,
                },
                conflictAlgorithm: ConflictAlgorithm.replace,
              );

              localItemModels.add(
                PurchaseItemModel(
                  id: lineId,
                  itemId: resolvedItemId,
                  itemName: line.itemName.trim(),
                  baseUnit: baseUnit.isEmpty ? 'حبة' : baseUnit,
                  unit: line.unit.trim().isEmpty ? 'حبة' : line.unit.trim(),
                  conversionFactor: line.conversionFactor,
                  quantity: line.quantity,
                  baseQuantity: addedBaseQty,
                  unitCostPrice: line.unitCostPrice,
                  taxAmount: line.taxAmount,
                  discountAmount: line.discountAmount,
                  totalLineCost: line.lineTotal,
                  effectiveBaseUnitCost: effectiveCost,
                  sellPrice: line.sellPrice,
                  returnedQuantity: 0.0,
                ),
              );
            }

            if (remaining > 0) {
              final supRows = await txn.query(
                'suppliers',
                where: 'id = ?',
                whereArgs: [supplierId],
                limit: 1,
              );
              if (supRows.isNotEmpty) {
                final curBal =
                    (supRows.first['current_balance'] as num?)?.toDouble() ?? 0.0;
                await txn.update(
                  'suppliers',
                  {'current_balance': curBal + remaining},
                  where: 'id = ?',
                  whereArgs: [supplierId],
                );
              }
            }

            await AppDatabase.enqueueOperation(
              txn,
              clientOpId: resolvedClientOpId,
              opType: 'PURCHASE',
              payload: payload,
            );
          });
        } else {
          await AppDatabase.enqueueOperation(
            db,
            clientOpId: resolvedClientOpId,
            opType: 'PURCHASE',
            payload: payload,
          );
        }

        await _loadOfflinePurchases(storeOwnerId);
        _isLoading = false;
        notifyListeners();
        return PurchaseInvoiceModel(
          id: resolvedInvoiceId,
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
          currency: savedCurrency,
          currencySymbol: savedSymbol,
          status: 'POSTED',
          costingMethodUsed: resolvedMethod,
          itemsCount: localItemModels.length,
          items: localItemModels,
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
    String? quantityUnit,
    required String refundMethod, // DEBT_REDUCTION | CASH_REFUND
    required String reason,
    String? storeOwnerId,
    String? clientOpId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    if (quantity <= 0) {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'الكمية المرتجعة يجب أن تكون أكبر من صفر.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (reason.trim().length < 2) {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'سبب المرتجع مطلوب.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (quantityUnit == 'GRAM' && (quantity - quantity.roundToDouble()).abs() > 1e-6) {
      _errorCode = 'FRACTIONAL_GRAMS_NOT_ALLOWED';
      _errorMessage = 'الكمية المرتجعة بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    final opId = (clientOpId != null && clientOpId.trim().isNotEmpty)
        ? clientOpId.trim()
        : _uuid.v4();
    final payload = <String, dynamic>{
      'id': opId,
      'clientOpId': opId,
      'purchaseInvoiceId': invoiceId,
      'purchaseItemId': purchaseItemId,
      'quantity': quantity,
      if (quantityUnit != null) 'quantityUnit': quantityUnit,
      'refundMethod': refundMethod,
      'reason': reason.trim(),
    };

    try {
      await _api.post(ApiEndpoints.purchaseReturns(invoiceId), data: payload);
      await fetchPurchases(storeOwnerId: storeOwnerId);
      return true;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        return await _enqueueOfflinePurchaseReturn(
          storeOwnerId: storeOwnerId,
          opId: opId,
          invoiceId: invoiceId,
          purchaseItemId: purchaseItemId,
          quantity: quantity,
          quantityUnit: quantityUnit,
          refundMethod: refundMethod,
          reason: reason.trim(),
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

  Future<bool> _enqueueOfflinePurchaseReturn({
    required String storeOwnerId,
    required String opId,
    required String invoiceId,
    required String purchaseItemId,
    required double quantity,
    String? quantityUnit,
    required String refundMethod,
    required String reason,
    required Map<String, dynamic> payload,
  }) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);

      // فحص منع التكرار لنفس clientOpId
      final existingRet = await db.query(
        'purchase_returns',
        where: 'id = ? OR client_op_id = ?',
        whereArgs: [opId, opId],
        limit: 1,
      );
      if (existingRet.isNotEmpty) {
        await AppDatabase.enqueueOperation(
          db,
          clientOpId: opId,
          opType: 'PURCHASE_RETURN',
          payload: payload,
        );
        await _loadOfflinePurchases(storeOwnerId);
        _isLoading = false;
        notifyListeners();
        return true;
      }

      final invRows = await db.query(
        'purchase_invoices',
        where: 'id = ?',
        whereArgs: [invoiceId],
        limit: 1,
      );
      if (invRows.isEmpty) {
        _errorCode = 'NOT_FOUND';
        _errorMessage = 'فاتورة الشراء غير موجودة محلياً.';
        _isLoading = false;
        notifyListeners();
        return false;
      }
      final invRow = invRows.first;
      if ((invRow['status']?.toString() ?? 'POSTED') != 'POSTED') {
        _errorCode = 'VALIDATION_ERROR';
        _errorMessage = 'لا يمكن تسجيل مرتجع إلا لفاتورة شراء مرحّلة ومعتمدة.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      final pItemRows = await db.query(
        'purchase_items',
        where: 'id = ? AND purchase_invoice_id = ?',
        whereArgs: [purchaseItemId, invoiceId],
        limit: 1,
      );
      if (pItemRows.isEmpty) {
        _errorCode = 'NOT_FOUND';
        _errorMessage = 'بند الفاتورة المحدد غير موجود.';
        _isLoading = false;
        notifyListeners();
        return false;
      }
      final pItem = pItemRows.first;
      final itemId = pItem['item_id']?.toString();
      final pUnit = pItem['unit']?.toString() ?? 'حبة';
      final pBaseUnit = pItem['base_unit']?.toString() ?? pUnit;
      final cf = (pItem['conversion_factor'] as num?)?.toDouble() ?? 1.0;
      final purchasedQty = (pItem['quantity'] as num?)?.toDouble() ?? 0.0;
      final baseQty =
          (pItem['base_quantity'] as num?)?.toDouble() ?? (purchasedQty * cf);
      final totalLineCost = (pItem['total_line_cost'] as num?)?.toDouble() ?? 0.0;
      final returnedQtySoFar = (pItem['returned_quantity'] as num?)?.toDouble() ?? 0.0;
      final effectiveBaseUnitCost =
          (pItem['effective_base_unit_cost'] as num?)?.toDouble() ??
          (baseQty > 0 ? totalLineCost / baseQty : 0.0);

      double returnQty = quantity;
      if (quantityUnit == 'GRAM') {
        if (isKiloUnit(pUnit)) {
          returnQty = (quantity / 1000.0 * 1000).roundToDouble() / 1000.0;
        } else if (isKiloUnit(pBaseUnit) && cf > 0) {
          final baseTmp = (quantity / 1000.0 * 1000).roundToDouble() / 1000.0;
          returnQty = (baseTmp / cf * 1000).roundToDouble() / 1000.0;
        }
      }

      final maxReturnable =
          ((purchasedQty - returnedQtySoFar) * 1000).roundToDouble() / 1000.0;
      if (returnQty > maxReturnable + 1e-6) {
        _errorCode = 'RETURN_QTY_EXCEEDS_PURCHASED';
        _errorMessage = 'الكمية المرتجعة تتجاوز الكمية المشتراة المتبقية في الفاتورة.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      final returnBaseQty = (returnQty * cf * 1000).roundToDouble() / 1000.0;

      // التحقق من توفر المخزون المحلي وعدم وجود مبيعات سابقة على الصنف
      if (itemId != null && itemId.isNotEmpty) {
        final itemRows = await db.query(
          'items',
          where: 'id = ? AND deleted_at IS NULL',
          whereArgs: [itemId],
          limit: 1,
        );
        if (itemRows.isNotEmpty) {
          final currentStock = (itemRows.first['quantity'] as num?)?.toDouble() ?? 0.0;
          if (returnBaseQty > currentStock + 1e-6) {
            _errorCode = 'INSUFFICIENT_STOCK';
            _errorMessage = 'الكمية المتوفرة في المخزون أقل من الكمية المراد إرجاعها للمورد.';
            _isLoading = false;
            notifyListeners();
            return false;
          }
        }
      }

      final returnAmount =
          (returnBaseQty * effectiveBaseUnitCost * 100).roundToDouble() / 100.0;
      final invRemaining = (invRow['remaining_amount'] as num?)?.toDouble() ?? 0.0;
      final supplierId = invRow['supplier_id']?.toString() ?? '';

      if (refundMethod == 'DEBT_REDUCTION' && returnAmount > invRemaining + 0.005) {
        _errorCode = 'VALIDATION_ERROR';
        _errorMessage =
            'المبلغ المتبقي غير المسدد على هذه الفاتورة أقل من قيمة المرتجع. اختر الاسترداد النقدي (CASH_REFUND).';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      final nowIso = DateTime.now().toIso8601String();

      await db.transaction((txn) async {
        await txn.update(
          'purchase_items',
          {
            'returned_quantity':
                ((returnedQtySoFar + returnQty) * 1000).roundToDouble() / 1000.0,
          },
          where: 'id = ?',
          whereArgs: [purchaseItemId],
        );

        if (itemId != null && itemId.isNotEmpty) {
          final itemRows = await txn.query(
            'items',
            where: 'id = ?',
            whereArgs: [itemId],
            limit: 1,
          );
          if (itemRows.isNotEmpty) {
            final curStock = (itemRows.first['quantity'] as num?)?.toDouble() ?? 0.0;
            final nextStock =
                ((curStock - returnBaseQty) * 1000).roundToDouble() / 1000.0;
            await txn.update(
              'items',
              {'quantity': nextStock < 0 ? 0.0 : nextStock},
              where: 'id = ?',
              whereArgs: [itemId],
            );
          }
        }

        if (refundMethod == 'DEBT_REDUCTION') {
          final nextRemaining =
              ((invRemaining - returnAmount) * 100).roundToDouble() / 100.0;
          await txn.update(
            'purchase_invoices',
            {
              'remaining_amount': nextRemaining < 0 ? 0.0 : nextRemaining,
            },
            where: 'id = ?',
            whereArgs: [invoiceId],
          );

          if (supplierId.isNotEmpty) {
            final supRows = await txn.query(
              'suppliers',
              where: 'id = ?',
              whereArgs: [supplierId],
              limit: 1,
            );
            if (supRows.isNotEmpty) {
              final curBal =
                  (supRows.first['current_balance'] as num?)?.toDouble() ?? 0.0;
              final nextBal =
                  ((curBal - returnAmount) * 100).roundToDouble() / 100.0;
              await txn.update(
                'suppliers',
                {'current_balance': nextBal < 0 ? 0.0 : nextBal},
                where: 'id = ?',
                whereArgs: [supplierId],
              );
            }
          }
        }

        await txn.insert(
          'purchase_returns',
          {
            'id': opId,
            'client_op_id': opId,
            'purchase_invoice_id': invoiceId,
            'purchase_item_id': purchaseItemId,
            'quantity': returnQty,
            'total_amount': returnAmount,
            'refund_method': refundMethod,
            'reason': reason,
            'returned_at': nowIso,
            'synced': 0,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );

        await AppDatabase.enqueueOperation(
          txn,
          clientOpId: opId,
          opType: 'PURCHASE_RETURN',
          payload: payload,
        );
      });

      await _loadOfflinePurchases(storeOwnerId);
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
}

