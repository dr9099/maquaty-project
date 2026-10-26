import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';

class DashboardSummary {
  final double totalSales;
  final double todayCash;
  final int salesCount;
  final String dayStatus;

  DashboardSummary({
    required this.totalSales,
    required this.todayCash,
    required this.salesCount,
    required this.dayStatus,
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    return DashboardSummary(
      totalSales: (json['total_sales'] as num?)?.toDouble() ?? 0.0,
      todayCash: (json['today_cash'] as num?)?.toDouble() ?? 0.0,
      salesCount: (json['sales_count'] as num?)?.toInt() ?? 0,
      dayStatus: json['day_status'] ?? 'OPEN',
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
