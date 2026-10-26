import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';

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
      id: json['id'],
      name: json['name'],
      phone: json['phone'],
      creditLimit: (json['credit_limit'] as num?)?.toDouble(),
      totalDebt: (json['total_debt'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class CreditProvider with ChangeNotifier {
  final ApiClient _api;

  List<CreditCustomer> _customers = [];
  bool _isLoading = false;
  String? _errorMessage;

  CreditProvider(this._api);

  List<CreditCustomer> get customers => _customers;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  Future<void> fetchCustomers({String? search}) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final res = await _api.get(
        ApiEndpoints.creditCustomers,
        queryParameters: search != null && search.isNotEmpty ? {'search': search} : null,
      );
      final List<dynamic> list = res.data ?? [];
      _customers = list.map((e) => CreditCustomer.fromJson(e)).toList();
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> addCustomer({
    required String name,
    String? phone,
    double? creditLimit,
  }) async {
    _isLoading = true;
    _errorMessage = null;
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
      await fetchCustomers();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> recordPayment({
    required String customerId,
    required double amount,
    String paymentMethod = 'CASH',
    String? notes,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.post(
        ApiEndpoints.creditPayments(customerId),
        data: {
          'amount': amount,
          'paymentMethod': paymentMethod,
          if (notes != null) 'notes': notes,
        },
      );
      await fetchCustomers();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
