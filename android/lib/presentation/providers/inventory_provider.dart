import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';

class ItemModel {
  final String id;
  final String name;
  final double quantity;
  final double sellPrice;
  final double? costPrice;
  final String emergencyPriceMode;
  final double? emergencyPriceMin;
  final double? emergencyPriceMax;

  ItemModel({
    required this.id,
    required this.name,
    required this.quantity,
    required this.sellPrice,
    this.costPrice,
    this.emergencyPriceMode = 'MANUAL_RANGE',
    this.emergencyPriceMin,
    this.emergencyPriceMax,
  });

  factory ItemModel.fromJson(Map<String, dynamic> json) {
    return ItemModel(
      id: json['id'],
      name: json['name'],
      quantity: (json['quantity'] as num?)?.toDouble() ?? 0.0,
      sellPrice: (json['sell_price'] as num?)?.toDouble() ?? 0.0,
      costPrice: (json['cost_price'] as num?)?.toDouble(),
      emergencyPriceMode: json['emergency_price_mode'] ?? 'MANUAL_RANGE',
      emergencyPriceMin: (json['emergency_price_min'] as num?)?.toDouble(),
      emergencyPriceMax: (json['emergency_price_max'] as num?)?.toDouble(),
    );
  }
}

class InventoryProvider with ChangeNotifier {
  final ApiClient _api;

  List<ItemModel> _items = [];
  bool _isLoading = false;
  String? _errorMessage;

  InventoryProvider(this._api);

  List<ItemModel> get items => _items;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  Future<void> fetchInventory({String? search}) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final res = await _api.get(
        ApiEndpoints.inventory,
        queryParameters: search != null && search.isNotEmpty ? {'search': search} : null,
      );

      final List<dynamic> list = res.data;
      _items = list.map((e) => ItemModel.fromJson(e)).toList();
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> addItem({
    required String name,
    required double quantity,
    required double costPrice,
    required double sellPrice,
    String emergencyPriceMode = 'MANUAL_RANGE',
    double? minEmergencyPrice,
    double? maxEmergencyPrice,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.post(
        ApiEndpoints.items,
        data: {
          'name': name,
          'quantity': quantity,
          'costPrice': costPrice,
          'sellPrice': sellPrice,
          'emergencyPriceMode': emergencyPriceMode,
          if (minEmergencyPrice != null) 'emergencyPriceMin': minEmergencyPrice,
          if (maxEmergencyPrice != null) 'emergencyPriceMax': maxEmergencyPrice,
        },
      );
      await fetchInventory();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> recordDamagedGoods({
    required String itemId,
    required double quantity,
    required String reason,
    String? photoUrl,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _api.post(
        ApiEndpoints.damagedGoods,
        data: {
          'itemId': itemId,
          'quantity': quantity,
          'reason': reason,
          'isDamaged': true,
          if (photoUrl != null) 'photoUrl': photoUrl,
        },
      );
      await fetchInventory();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
