import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../data/local/app_database.dart';

class SupplierModel {
  final String id;
  final String name;
  final String? phone;
  final String? address;
  final String? contactPerson;
  final String? taxNumber;
  final String? notes;
  final double openingBalance;
  final double currentBalance;
  final double? creditLimit;
  final int? paymentTermsDays;
  final String status;

  const SupplierModel({
    required this.id,
    required this.name,
    this.phone,
    this.address,
    this.contactPerson,
    this.taxNumber,
    this.notes,
    this.openingBalance = 0.0,
    this.currentBalance = 0.0,
    this.creditLimit,
    this.paymentTermsDays,
    this.status = 'ACTIVE',
  });

  bool get isActive => status == 'ACTIVE';
  bool get hasDebt => currentBalance > 0.001;

  factory SupplierModel.fromJson(Map<String, dynamic> json) {
    return SupplierModel(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      phone: json['phone']?.toString(),
      address: json['address']?.toString(),
      contactPerson: (json['contact_person'] ?? json['contactPerson'])?.toString(),
      taxNumber: (json['tax_number'] ?? json['taxNumber'])?.toString(),
      notes: json['notes']?.toString(),
      openingBalance:
          ((json['opening_balance'] ?? json['openingBalance']) as num?)?.toDouble() ?? 0.0,
      currentBalance:
          ((json['current_balance'] ?? json['currentBalance']) as num?)?.toDouble() ?? 0.0,
      creditLimit: ((json['credit_limit'] ?? json['creditLimit']) as num?)?.toDouble(),
      paymentTermsDays:
          ((json['payment_terms_days'] ?? json['paymentTermsDays']) as num?)?.toInt(),
      status: (json['status'] ?? 'ACTIVE').toString(),
    );
  }

  Map<String, dynamic> toDbMap({bool synced = true}) {
    return {
      'id': id,
      'name': name,
      'phone': phone,
      'address': address,
      'contact_person': contactPerson,
      'tax_number': taxNumber,
      'notes': notes,
      'opening_balance': openingBalance,
      'current_balance': currentBalance,
      'credit_limit': creditLimit,
      'payment_terms_days': paymentTermsDays,
      'status': status,
      'synced': synced ? 1 : 0,
    };
  }
}

class StatementTransactionItem {
  final String id;
  final String date;
  final String type;
  final String reference;
  final String description;
  final double debit;
  final double credit;
  final double runningBalance;

  const StatementTransactionItem({
    required this.id,
    required this.date,
    required this.type,
    required this.reference,
    required this.description,
    required this.debit,
    required this.credit,
    required this.runningBalance,
  });

  factory StatementTransactionItem.fromJson(Map<String, dynamic> json) {
    return StatementTransactionItem(
      id: (json['id'] ?? '').toString(),
      date: (json['date'] ?? '').toString(),
      type: (json['type'] ?? '').toString(),
      reference: (json['reference'] ?? '').toString(),
      description: (json['description'] ?? '').toString(),
      debit: (json['debit'] as num?)?.toDouble() ?? 0.0,
      credit: (json['credit'] as num?)?.toDouble() ?? 0.0,
      runningBalance: (json['running_balance'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class SupplierStatementData {
  final String storeName;
  final String currency;
  final String currencySymbol;
  final SupplierModel supplier;
  final double openingPeriodBalance;
  final double totalDebit;
  final double totalCredit;
  final double closingBalance;
  final List<StatementTransactionItem> transactions;
  final String? csvContent;

  const SupplierStatementData({
    required this.storeName,
    required this.currency,
    required this.currencySymbol,
    required this.supplier,
    required this.openingPeriodBalance,
    required this.totalDebit,
    required this.totalCredit,
    required this.closingBalance,
    required this.transactions,
    this.csvContent,
  });

  factory SupplierStatementData.fromJson(Map<String, dynamic> json) {
    final period = Map<String, dynamic>.from(json['period'] ?? {});
    final txList = (json['transactions'] as List? ?? [])
        .map((e) => StatementTransactionItem.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    return SupplierStatementData(
      storeName: (json['store_name'] ?? 'متجر مَقوتي').toString(),
      currency: (json['currency'] ?? 'YER').toString(),
      currencySymbol: (json['currency_symbol'] ?? 'ر.ي').toString(),
      supplier: SupplierModel.fromJson(Map<String, dynamic>.from(json['supplier'] ?? {})),
      openingPeriodBalance: (period['opening_period_balance'] as num?)?.toDouble() ?? 0.0,
      totalDebit: (period['total_debit'] as num?)?.toDouble() ?? 0.0,
      totalCredit: (period['total_credit'] as num?)?.toDouble() ?? 0.0,
      closingBalance: (period['closing_balance'] as num?)?.toDouble() ?? 0.0,
      transactions: txList,
      csvContent: json['csv_content']?.toString(),
    );
  }
}

class SupplierAgingData {
  final double totalOutstanding;
  final double days0To30;
  final double days31To60;
  final double days61To90;
  final double days90Plus;
  final List<Map<String, dynamic>> openItems;

  const SupplierAgingData({
    required this.totalOutstanding,
    required this.days0To30,
    required this.days31To60,
    required this.days61To90,
    required this.days90Plus,
    required this.openItems,
  });

  factory SupplierAgingData.fromJson(Map<String, dynamic> json) {
    final b = Map<String, dynamic>.from(json['buckets'] ?? {});
    return SupplierAgingData(
      totalOutstanding: (json['total_outstanding'] as num?)?.toDouble() ?? 0.0,
      days0To30: (b['days_0_30'] as num?)?.toDouble() ?? 0.0,
      days31To60: (b['days_31_60'] as num?)?.toDouble() ?? 0.0,
      days61To90: (b['days_61_90'] as num?)?.toDouble() ?? 0.0,
      days90Plus: (b['days_90_plus'] as num?)?.toDouble() ?? 0.0,
      openItems: (json['open_items'] as List? ?? [])
          .map((e) => Map<String, dynamic>.from(e))
          .toList(),
    );
  }
}

/// مزود إدارة الموردين وحساباتهم وسداد الدفعات (حصري لمالك المتجر)
class SuppliersProvider with ChangeNotifier {
  final ApiClient _api;
  final _uuid = const Uuid();

  List<SupplierModel> _suppliers = [];
  int _totalCount = 0;
  double _totalPayables = 0.0;
  String _currencySymbol = 'ر.ي';
  bool _isLoading = false;
  String? _errorMessage;
  String? _errorCode;

  SuppliersProvider(this._api);

  List<SupplierModel> get suppliers => _suppliers;
  int get totalCount => _totalCount;
  double get totalPayables => _totalPayables;
  String get currencySymbol => _currencySymbol;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get errorCode => _errorCode;

  Future<void> fetchSuppliers({
    String? search,
    bool onlyWithDebt = false,
    String? status,
    int limit = 50,
    int offset = 0,
    String? storeOwnerId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      final query = <String, dynamic>{
        'limit': limit,
        'offset': offset,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (onlyWithDebt) 'only_with_debt': 'true',
        if (status != null && status.isNotEmpty) 'status': status,
      };
      final res = await _api.get(ApiEndpoints.suppliers, queryParameters: query);
      final data = Map<String, dynamic>.from(res.data);
      final list = (data['items'] as List? ?? [])
          .map((e) => SupplierModel.fromJson(Map<String, dynamic>.from(e)))
          .toList();

      _suppliers = list;
      _totalCount = (data['total'] as num?)?.toInt() ?? list.length;
      _totalPayables = (data['total_payables'] as num?)?.toDouble() ?? 0.0;
      _currencySymbol = (data['currency_symbol'] ?? _currencySymbol).toString();

      if (storeOwnerId != null && storeOwnerId.isNotEmpty) {
        try {
          final db = await AppDatabase.getInstance(storeOwnerId);
          for (final s in list) {
            await db.insert('suppliers', s.toDbMap(synced: true));
          }
        } catch (_) {}
      }
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        await _loadOfflineSuppliers(storeOwnerId, search: search, onlyWithDebt: onlyWithDebt);
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

  Future<void> _loadOfflineSuppliers(
    String storeOwnerId, {
    String? search,
    bool onlyWithDebt = false,
  }) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      final rows = await db.query('suppliers', where: 'deleted_at IS NULL');
      var list = rows.map((r) => SupplierModel.fromJson(r)).toList();
      if (search != null && search.trim().isNotEmpty) {
        final q = search.trim().toLowerCase();
        list = list
            .where((s) =>
                s.name.toLowerCase().contains(q) ||
                (s.phone ?? '').contains(q))
            .toList();
      }
      if (onlyWithDebt) {
        list = list.where((s) => s.currentBalance > 0).toList();
      }
      _suppliers = list;
      _totalCount = list.length;
      _totalPayables = list.fold(0.0, (sum, s) => sum + s.currentBalance);
    } catch (_) {}
  }

  Future<SupplierModel?> createSupplier({
    required String name,
    String? phone,
    String? address,
    String? contactPerson,
    String? taxNumber,
    String? notes,
    double openingBalance = 0.0,
    double? creditLimit,
    int? paymentTermsDays,
    String? storeOwnerId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    final generatedId = _uuid.v4();
    final payload = <String, dynamic>{
      'id': generatedId,
      'name': name.trim(),
      if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
      if (address != null && address.trim().isNotEmpty) 'address': address.trim(),
      if (contactPerson != null && contactPerson.trim().isNotEmpty)
        'contactPerson': contactPerson.trim(),
      if (taxNumber != null && taxNumber.trim().isNotEmpty)
        'taxNumber': taxNumber.trim(),
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      if (openingBalance > 0) 'openingBalance': openingBalance,
      if (creditLimit != null) 'creditLimit': creditLimit,
      if (paymentTermsDays != null) 'paymentTermsDays': paymentTermsDays,
    };

    try {
      final res = await _api.post(ApiEndpoints.suppliers, data: payload);
      final created = SupplierModel.fromJson(Map<String, dynamic>.from(res.data));
      await fetchSuppliers(storeOwnerId: storeOwnerId);
      return created;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        final db = await AppDatabase.getInstance(storeOwnerId);
        final offlineSupplier = SupplierModel(
          id: generatedId,
          name: name.trim(),
          phone: phone?.trim(),
          address: address?.trim(),
          contactPerson: contactPerson?.trim(),
          taxNumber: taxNumber?.trim(),
          notes: notes?.trim(),
          openingBalance: openingBalance,
          currentBalance: openingBalance,
          creditLimit: creditLimit,
          paymentTermsDays: paymentTermsDays,
        );
        await db.insert('suppliers', offlineSupplier.toDbMap(synced: false));
        await AppDatabase.enqueueOperation(
          db,
          clientOpId: _uuid.v4(),
          opType: 'SUPPLIER_CREATE',
          payload: payload,
        );
        await _loadOfflineSuppliers(storeOwnerId);
        _isLoading = false;
        notifyListeners();
        return offlineSupplier;
      }
      _errorCode = e.code;
      _errorMessage = e.message;
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

  Future<bool> updateSupplier(
    String id, {
    String? name,
    String? phone,
    String? address,
    String? contactPerson,
    String? taxNumber,
    String? notes,
    double? creditLimit,
    int? paymentTermsDays,
    String? status,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      final payload = <String, dynamic>{
        if (name != null) 'name': name.trim(),
        if (phone != null) 'phone': phone.trim(),
        if (address != null) 'address': address.trim(),
        if (contactPerson != null) 'contactPerson': contactPerson.trim(),
        if (taxNumber != null) 'taxNumber': taxNumber.trim(),
        if (notes != null) 'notes': notes.trim(),
        if (creditLimit != null) 'creditLimit': creditLimit,
        if (paymentTermsDays != null) 'paymentTermsDays': paymentTermsDays,
        if (status != null) 'status': status,
      };
      await _api.patch(ApiEndpoints.supplierById(id), data: payload);
      await fetchSuppliers();
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

  Future<bool> deleteSupplier(String id) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      await _api.delete(ApiEndpoints.supplierById(id));
      await fetchSuppliers();
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

  Future<bool> recordPayment({
    required String supplierId,
    required double amount,
    required String paymentMethod, // CASH | ELECTRONIC
    String? walletId,
    String? purchaseInvoiceId,
    String? receiptAttachmentUrl,
    String? notes,
    String? storeOwnerId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    final paymentId = _uuid.v4();
    final payload = <String, dynamic>{
      'id': paymentId,
      'amount': amount,
      'paymentMethod': paymentMethod,
      if (walletId != null && walletId.isNotEmpty) 'walletId': walletId,
      if (purchaseInvoiceId != null && purchaseInvoiceId.isNotEmpty)
        'purchaseInvoiceId': purchaseInvoiceId,
      if (receiptAttachmentUrl != null && receiptAttachmentUrl.isNotEmpty)
        'receiptAttachmentUrl': receiptAttachmentUrl,
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
    };

    try {
      await _api.post(ApiEndpoints.supplierPayments(supplierId), data: payload);
      await fetchSuppliers(storeOwnerId: storeOwnerId);
      return true;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        final db = await AppDatabase.getInstance(storeOwnerId);
        await db.insert('supplier_payments', {
          'id': paymentId,
          'client_op_id': paymentId,
          'supplier_id': supplierId,
          'purchase_invoice_id': purchaseInvoiceId,
          'amount': amount,
          'payment_method': paymentMethod,
          'wallet_id': walletId,
          'receipt_attachment_url': receiptAttachmentUrl,
          'notes': notes,
          'paid_at': DateTime.now().toIso8601String(),
          'synced': 0,
        });
        await AppDatabase.enqueueOperation(
          db,
          clientOpId: _uuid.v4(),
          opType: 'SUPPLIER_PAYMENT',
          payload: {'supplierId': supplierId, ...payload},
        );
        _isLoading = false;
        notifyListeners();
        return true;
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

  Future<SupplierStatementData?> fetchStatement(
    String supplierId, {
    String? dateFrom,
    String? dateTo,
    String? format,
  }) async {
    _errorMessage = null;
    _errorCode = null;
    try {
      final res = await _api.get(
        ApiEndpoints.supplierStatement(supplierId),
        queryParameters: {
          if (dateFrom != null && dateFrom.isNotEmpty) 'date_from': dateFrom,
          if (dateTo != null && dateTo.isNotEmpty) 'date_to': dateTo,
          if (format != null && format.isNotEmpty) 'format': format,
        },
      );
      return SupplierStatementData.fromJson(Map<String, dynamic>.from(res.data));
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

  Future<SupplierAgingData?> fetchAging(String supplierId) async {
    try {
      final res = await _api.get(ApiEndpoints.supplierAging(supplierId));
      return SupplierAgingData.fromJson(Map<String, dynamic>.from(res.data));
    } catch (_) {
      return null;
    }
  }
}

