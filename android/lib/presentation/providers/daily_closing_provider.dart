import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';

class DailyClosingData {
  final String id;
  final String closingDate;
  final String status;
  final double expectedCash;
  final double? actualCash;
  final double? difference;
  final List<dynamic> workers;

  DailyClosingData({
    required this.id,
    required this.closingDate,
    required this.status,
    required this.expectedCash,
    this.actualCash,
    this.difference,
    this.workers = const [],
  });

  bool get isClosed => status == 'CLOSED';

  factory DailyClosingData.fromJson(Map<String, dynamic> json) {
    return DailyClosingData(
      id: json['id'] ?? '',
      closingDate: json['closing_date'] ?? '',
      status: json['status'] ?? 'OPEN',
      expectedCash: (json['expected_cash'] as num?)?.toDouble() ?? 0.0,
      actualCash: (json['actual_cash'] as num?)?.toDouble(),
      difference: (json['difference'] as num?)?.toDouble(),
      workers: json['workers'] ?? [],
    );
  }
}

class DailyClosingProvider with ChangeNotifier {
  final ApiClient _api;

  DailyClosingData? _closing;
  bool _isLoading = false;
  String? _errorMessage;

  DailyClosingProvider(this._api);

  DailyClosingData? get closing => _closing;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  Future<void> fetchTodayClosing() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final res = await _api.get(ApiEndpoints.dailyClosingToday);
      _closing = DailyClosingData.fromJson(res.data);
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> updateWorkerCash(String workerId, double actualCash) async {
    if (_closing == null) return false;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.post(
        ApiEndpoints.dailyClosingWorkerCash(_closing!.id, workerId),
        data: {'actualCash': actualCash},
      );
      await fetchTodayClosing();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> approveClosing({double? ownerActualCash}) async {
    if (_closing == null) return false;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.post(
        ApiEndpoints.dailyClosingApprove(_closing!.id),
        data: {
          if (ownerActualCash != null) 'actualCash': ownerActualCash,
        },
      );
      await fetchTodayClosing();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
