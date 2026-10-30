import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';

class DashboardSummary {
  final double totalSales;
  final double todayCash;
  final int salesCount;
  final String dayStatus;
  final String currency;
  final String currencySymbol;
  final double? purchasesTodayTotal;
  final int? purchasesTodayCount;
  final double? supplierPayablesTotal;

  DashboardSummary({
    required this.totalSales,
    required this.todayCash,
    required this.salesCount,
    required this.dayStatus,
    this.currency = 'YER',
    this.currencySymbol = 'ر.ي',
    this.purchasesTodayTotal,
    this.purchasesTodayCount,
    this.supplierPayablesTotal,
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    return DashboardSummary(
      totalSales: ((json['total_sales'] ?? json['sales_today_total']) as num?)?.toDouble() ?? 0.0,
      todayCash: ((json['today_cash'] ?? json['cash_today']) as num?)?.toDouble() ?? 0.0,
      salesCount: ((json['sales_count'] ?? json['sales_today_count']) as num?)?.toInt() ?? 0,
      dayStatus: (json['day_status'] ?? json['today_status'] ?? 'OPEN').toString(),
      currency: (json['currency'] ?? 'YER').toString(),
      currencySymbol: (json['currency_symbol'] ?? 'ر.ي').toString(),
      purchasesTodayTotal: (json['purchases_today_total'] as num?)?.toDouble(),
      purchasesTodayCount: (json['purchases_today_count'] as num?)?.toInt(),
      supplierPayablesTotal: (json['supplier_payables_total'] as num?)?.toDouble(),
    );
  }
}

class DashboardProvider with ChangeNotifier {
  final ApiClient _api;

  DashboardSummary? _summary;
  bool _isLoading = false;
  String? _errorMessage;

  DashboardProvider(this._api);

  DashboardSummary? get summary => _summary;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  Future<void> fetchSummary() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final res = await _api.get(ApiEndpoints.dashboardSummary);
      _summary = DashboardSummary.fromJson(res.data);
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
