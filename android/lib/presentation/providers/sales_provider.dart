import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../core/utils/quantity_formatter.dart';

class SaleRecord {
  final String id;
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

  factory SaleRecord.fromJson(Map<String, dynamic> json) {
    final unitVal = (json['item']?['unit'] ?? json['unit'] ?? 'كيلو').toString();
    final qtyVal = (json['quantity'] as num?)?.toDouble() ?? 0.0;
    return SaleRecord(
      id: json['id'],
      itemName: json['item']?['name'] ?? json['itemName'] ?? 'صنف',
      unit: unitVal,
      quantity: qtyVal,
      quantityDisplay: json['quantity_display'] ?? formatQuantityDisplay(qtyVal, unit: unitVal),
      amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
      paymentType: json['payment_type'] ?? 'CASH',
      isEmergencySale: json['is_emergency_sale'] ?? false,
      emergencyOverridePrice: (json['emergency_override_price'] as num?)?.toDouble(),
      emergencyReason: json['emergency_reason'],
      soldAt: DateTime.tryParse(json['sold_at'] ?? '') ?? DateTime.now(),
      workerName: json['worker']?['name'],
    );
  }
}

class SalesProvider with ChangeNotifier {
  final ApiClient _api;

  List<SaleRecord> _todaySales = [];
  bool _isLoading = false;
  String? _errorMessage;

  SalesProvider(this._api);

  List<SaleRecord> get todaySales => _todaySales;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  Future<void> fetchTodaySales() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final res = await _api.get(ApiEndpoints.salesToday);
      final List<dynamic> list = res.data ?? [];
      _todaySales = list.map((e) => SaleRecord.fromJson(e)).toList();
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
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
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.post(
        ApiEndpoints.sales,
        data: {
          'itemId': itemId,
          'quantity': quantity,
          if (quantityUnit != null) 'quantityUnit': quantityUnit,
          'amount': amount,
          'paymentType': paymentType,
          if (walletId != null) 'walletId': walletId,
          if (depositAttachmentUrl != null) 'depositAttachmentUrl': depositAttachmentUrl,
          if (creditCustomerId != null) 'creditCustomerId': creditCustomerId,
          if (isEmergencySale) ...{
            'isEmergencySale': true,
            'emergencyOverridePrice': emergencyOverridePrice,
            'emergencyReason': emergencyReason,
          },
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
