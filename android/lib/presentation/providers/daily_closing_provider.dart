import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';

class DailyClosingData {
  final String id;
  final String closingDate;
  final String? workerId;
  final String status;
  final double openingCash;
  final double expectedCash;
  final double? actualCash;
  final double? difference;
  final Map<String, dynamic> summary;
  final List<dynamic> workers;

  DailyClosingData({
    required this.id,
    required this.closingDate,
    this.workerId,
    required this.status,
    this.openingCash = 0.0,
    required this.expectedCash,
    this.actualCash,
    this.difference,
    this.summary = const {},
    this.workers = const [],
  });

  bool get isClosed => status == 'CLOSED';

  factory DailyClosingData.fromJson(Map<String, dynamic> json) {
    final rawDate = (json['closing_date'] ?? '').toString();
    return DailyClosingData(
      id: (json['closing_id'] ?? json['id'] ?? '').toString(),
      closingDate: rawDate.length >= 10 ? rawDate.substring(0, 10) : rawDate,
      workerId: json['worker_id']?.toString(),
      status: (json['status'] ?? 'OPEN').toString(),
      openingCash: (json['opening_cash'] as num?)?.toDouble() ?? 0.0,
      expectedCash: (json['expected_cash'] as num?)?.toDouble() ?? 0.0,
      actualCash: (json['actual_cash'] as num?)?.toDouble(),
      difference: (json['difference'] as num?)?.toDouble(),
      summary: json['summary'] is Map
          ? Map<String, dynamic>.from(json['summary'])
          : const {},
      workers: json['workers'] is List ? json['workers'] : const [],
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

  Future<void> fetchTodayClosing({String? workerId}) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final res = await _api.get(
        ApiEndpoints.dailyClosingToday,
        queryParameters:
            workerId != null && workerId.isNotEmpty ? {'worker_id': workerId} : null,
      );
      if (res.data is Map) {
        _closing = DailyClosingData.fromJson(Map<String, dynamic>.from(res.data));
      }
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> updateActualCash(double actualCash, {String? workerId}) async {
    if (_closing == null) return false;
    if (workerId != null && workerId.isNotEmpty) {
      return updateWorkerCash(workerId, actualCash);
    }
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.patch(
        ApiEndpoints.dailyClosingUpdate(_closing!.id),
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

  Future<bool> updateWorkerCash(String workerId, double actualCash) async {
    if (_closing == null) return false;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.patch(
        ApiEndpoints.dailyClosingWorkerCash(_closing!.id, workerId),
        data: {'actualCash': actualCash},
      );
      await fetchTodayClosing(workerId: workerId);
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
      if (ownerActualCash != null) {
        await _api.patch(
          ApiEndpoints.dailyClosingUpdate(_closing!.id),
          data: {'actualCash': ownerActualCash},
        );
      }
      await _api.post(ApiEndpoints.dailyClosingApprove(_closing!.id));
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
