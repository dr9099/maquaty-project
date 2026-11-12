import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';
import '../../core/utils/quantity_formatter.dart';
import '../../data/local/app_database.dart';

class ItemModel {
  final String id;
  final String name;
  final String unit;
  final double quantity;
  final String? quantityDisplay;
  final double sellPrice;
  final double? costPrice;
  final String emergencyPriceMode;
  final double? emergencyPricePlusFixed;
  final double? emergencyPricePlusPercent;
  final double? emergencyPriceMin;
  final double? emergencyPriceMax;
  final double? emergencyMinPrice;
  final double? emergencyMaxPrice;

  ItemModel({
    required this.id,
    required this.name,
    this.unit = 'حبة',
    required this.quantity,
    this.quantityDisplay,
    required this.sellPrice,
    this.costPrice,
    this.emergencyPriceMode = 'RANGE_OR_OPEN',
    this.emergencyPricePlusFixed,
    this.emergencyPricePlusPercent,
    this.emergencyPriceMin,
    this.emergencyPriceMax,
    this.emergencyMinPrice,
    this.emergencyMaxPrice,
  });

  static const Set<String> _weightUnits = {
    'كيلو',
    'كجم',
    'كيلوغرام',
    'كيلوجرام',
    'kg',
    'kilo',
    'kilogram',
    'جرام',
    'جم',
    'غ',
    'g',
    'gram',
  };

  static const Set<String> _kiloUnits = {
    'كيلو',
    'كجم',
    'كيلوغرام',
    'كيلوجرام',
    'kg',
    'kilo',
    'kilogram',
  };

  static bool isWeightUnitName(String unit) {
    return _weightUnits.contains(unit.trim().toLowerCase());
  }

  static bool isKiloUnitName(String unit) {
    return _kiloUnits.contains(unit.trim().toLowerCase());
  }

  bool get isWeightUnit => isWeightUnitName(unit);
  bool get isKiloUnit => isKiloUnitName(unit);

  String get displayQuantity =>
      quantityDisplay ?? formatQuantityDisplay(quantity, unit: unit);

  double? get effectiveEmergencyMinPrice {
    if (emergencyMinPrice != null) return emergencyMinPrice;
    if (costPrice != null && costPrice! > 0) {
      if (emergencyPriceMode == 'COST_ONLY') {
        return costPrice;
      } else if (emergencyPriceMode == 'COST_PLUS') {
        final fixed = emergencyPricePlusFixed;
        final percent = emergencyPricePlusPercent;
        final margin = fixed ?? (costPrice! * (percent ?? 0.0) / 100.0);
        return costPrice! + margin;
      }
    }
    return emergencyPriceMin;
  }

  double? get effectiveEmergencyMaxPrice {
    if (emergencyMaxPrice != null) return emergencyMaxPrice;
    if (emergencyPriceMode == 'COST_ONLY') {
      return costPrice;
    }
    return emergencyPriceMax;
  }

  static String normalizeEmergencyMode(String? raw) {
    switch (raw) {
      case 'COST_ONLY':
        return 'COST_ONLY';
      case 'COST_PLUS':
      case 'PLUS_FIXED':
      case 'PLUS_PERCENT':
        return 'COST_PLUS';
      case 'RANGE_OR_OPEN':
      case 'MANUAL_RANGE':
      case 'UNRESTRICTED':
      default:
        return 'RANGE_OR_OPEN';
    }
  }

  factory ItemModel.fromJson(Map<String, dynamic> json) {
    final unitVal = (json['unit'] ?? 'حبة').toString();
    final qtyVal =
        ((json['quantity'] ?? json['remaining_qty']) as num?)?.toDouble() ?? 0.0;
    return ItemModel(
      id: (json['id'] ?? json['item_id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      unit: unitVal,
      quantity: qtyVal,
      quantityDisplay: json['quantity_display'] ??
          formatQuantityDisplay(qtyVal, unit: unitVal),
      sellPrice: ((json['sell_price'] ?? json['sellPrice']) as num?)?.toDouble() ?? 0.0,
      costPrice: ((json['cost_price'] ?? json['costPrice']) as num?)?.toDouble(),
      emergencyPriceMode: normalizeEmergencyMode(
        (json['emergency_price_mode'] ?? json['emergencyPriceMode'])?.toString(),
      ),
      emergencyPricePlusFixed: ((json['emergency_price_plus_fixed'] ??
                  json['emergencyPricePlusFixed']) as num?)
              ?.toDouble(),
      emergencyPricePlusPercent: ((json['emergency_price_plus_percent'] ??
                  json['emergencyPricePlusPercent']) as num?)
              ?.toDouble(),
      emergencyPriceMin:
          ((json['emergency_price_min'] ?? json['emergencyPriceMin']) as num?)
              ?.toDouble(),
      emergencyPriceMax:
          ((json['emergency_price_max'] ?? json['emergencyPriceMax']) as num?)
              ?.toDouble(),
      emergencyMinPrice: ((json['emergency_min_price'] ?? json['emergencyMinPrice']) as num?)
          ?.toDouble(),
      emergencyMaxPrice: ((json['emergency_max_price'] ?? json['emergencyMaxPrice']) as num?)
          ?.toDouble(),
    );
  }
}

class InventoryProvider with ChangeNotifier {
  final ApiClient _api;
  final _uuid = const Uuid();

  List<ItemModel> _items = [];
  bool _isLoading = false;
  String? _errorMessage;
  String? _errorCode;
  ApiException? _lastApiException;
  bool _lastOperationQueuedOffline = false;

  InventoryProvider(this._api);

  List<ItemModel> get items => _items;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get errorCode => _errorCode;
  ApiException? get lastApiException => _lastApiException;
  bool get lastOperationQueuedOffline => _lastOperationQueuedOffline;

  Future<void> fetchInventory({String? search, String? storeOwnerId}) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    _lastApiException = null;
    notifyListeners();

    try {
      final res = await _api.get(
        ApiEndpoints.inventory,
        queryParameters: search != null && search.isNotEmpty ? {'search': search} : null,
      );

      final List<dynamic> list = res.data;
      final fetched = list.map((e) => ItemModel.fromJson(e)).toList();
      _items = fetched;

      if (storeOwnerId != null && storeOwnerId.isNotEmpty) {
        try {
          final db = await AppDatabase.getInstance(storeOwnerId);
          for (final item in fetched) {
            await db.insert(
              'items',
              {
                'id': item.id,
                'name': item.name,
                'unit': item.unit,
                'quantity': item.quantity,
                'sell_price': item.sellPrice,
                'cost_price': item.costPrice,
                'emergency_price_mode': item.emergencyPriceMode,
                'emergency_price_min': item.emergencyPriceMin,
                'emergency_price_max': item.emergencyPriceMax,
                'deleted_at': null,
              },
              conflictAlgorithm: ConflictAlgorithm.replace,
            );
          }
        } catch (_) {}
      }
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        await _loadOfflineInventory(storeOwnerId, search: search);
      } else {
        _lastApiException = e;
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

  Future<void> _loadOfflineInventory(String storeOwnerId, {String? search}) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);
      final rows = await db.query(
        'items',
        where: 'deleted_at IS NULL',
        orderBy: 'name ASC',
      );
      var list = rows.map((r) => ItemModel.fromJson(r)).toList();
      if (search != null && search.trim().isNotEmpty) {
        final q = search.trim().toLowerCase();
        list = list.where((i) => i.name.toLowerCase().contains(q)).toList();
      }
      _items = list;
    } catch (_) {}
  }

  Future<bool> addItem({
    required String name,
    String unit = 'حبة',
    required double quantity,
    required double costPrice,
    required double sellPrice,
    String emergencyPriceMode = 'RANGE_OR_OPEN',
    double? emergencyPricePlusFixed,
    double? emergencyPricePlusPercent,
    double? minEmergencyPrice,
    double? maxEmergencyPrice,
    String? costingMethod,
    bool promptOnSameDayPriceDiff = false,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    _lastApiException = null;
    notifyListeners();

    try {
      final resolvedMode = ItemModel.normalizeEmergencyMode(emergencyPriceMode);
      await _api.post(
        ApiEndpoints.items,
        data: {
          'name': name,
          'unit': unit,
          'quantity': quantity,
          'costPrice': costPrice,
          'sellPrice': sellPrice,
          'emergencyPriceMode': resolvedMode,
          if (emergencyPricePlusFixed != null)
            'emergencyPricePlusFixed': emergencyPricePlusFixed,
          if (emergencyPricePlusPercent != null)
            'emergencyPricePlusPercent': emergencyPricePlusPercent,
          if (minEmergencyPrice != null) 'emergencyPriceMin': minEmergencyPrice,
          if (maxEmergencyPrice != null) 'emergencyPriceMax': maxEmergencyPrice,
          if (costingMethod != null) 'costingMethod': costingMethod,
          if (promptOnSameDayPriceDiff) 'promptOnSameDayPriceDiff': true,
        },
      );
      await fetchInventory();
      return true;
    } on ApiException catch (e) {
      _lastApiException = e;
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

  Future<bool> recordDamagedGoods({
    required String itemId,
    required double quantity,
    required String reason,
    String? photoUrl,
    bool isDamaged = true,
    String? storeOwnerId,
    bool canRecordDamagedGoods = true,
    String? clientOpId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    _lastOperationQueuedOffline = false;
    notifyListeners();

    if (!canRecordDamagedGoods) {
      _errorCode = 'PERMISSION_DENIED';
      _errorMessage = 'ليس لديك صلاحية تسجيل التالف.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (quantity <= 0) {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'الكمية التالفة يجب أن تكون أكبر من صفر.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (isDamaged && reason.trim().isEmpty) {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'سبب التلف إلزامي عند تأكيد التلف.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    if (isDamaged && (photoUrl == null || photoUrl.trim().isEmpty)) {
      _errorCode = 'VALIDATION_ERROR';
      _errorMessage = 'صورة التلف إلزامية عند تأكيد التلف.';
      _isLoading = false;
      notifyListeners();
      return false;
    }

    final opId = (clientOpId != null && clientOpId.trim().isNotEmpty)
        ? clientOpId.trim()
        : _uuid.v4();

    var finalPhotoUrl = photoUrl;
    if (finalPhotoUrl != null && finalPhotoUrl.trim().isNotEmpty) {
      final isLocal = !finalPhotoUrl.startsWith('http') &&
          !finalPhotoUrl.startsWith('/v1/uploads/');
      if (isLocal) {
        try {
          finalPhotoUrl = await _api.uploadFile(finalPhotoUrl.trim());
        } catch (_) {}
      }
    }

    final payload = <String, dynamic>{
      'id': opId,
      'clientOpId': opId,
      'itemId': itemId,
      'quantity': quantity,
      'reason': reason.trim(),
      'isDamaged': isDamaged,
      if (finalPhotoUrl != null && finalPhotoUrl.trim().isNotEmpty)
        'photoUrl': finalPhotoUrl.trim(),
    };

    try {
      await _api.post(
        ApiEndpoints.damagedGoods,
        data: payload,
      );
      await fetchInventory(storeOwnerId: storeOwnerId);
      return true;
    } on ApiException catch (e) {
      if (e.code == 'NETWORK_ERROR' && storeOwnerId != null && storeOwnerId.isNotEmpty) {
        return await _enqueueOfflineDamagedGoods(
          storeOwnerId: storeOwnerId,
          opId: opId,
          itemId: itemId,
          quantity: quantity,
          isDamaged: isDamaged,
          payload: payload,
        );
      }
      _lastApiException = e;
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

  Future<bool> _enqueueOfflineDamagedGoods({
    required String storeOwnerId,
    required String opId,
    required String itemId,
    required double quantity,
    required bool isDamaged,
    required Map<String, dynamic> payload,
  }) async {
    try {
      final db = await AppDatabase.getInstance(storeOwnerId);

      // فحص منع التكرار لنفس clientOpId حتى لا يُخصم المخزون مرتين
      final existingQueue = await db.query(
        'sync_queue',
        where: 'client_op_id = ?',
        whereArgs: [opId],
        limit: 1,
      );
      if (existingQueue.isNotEmpty) {
        await AppDatabase.enqueueOperation(
          db,
          clientOpId: opId,
          opType: 'DAMAGED_GOODS',
          payload: payload,
        );
        _lastOperationQueuedOffline = true;
        await _loadOfflineInventory(storeOwnerId);
        _isLoading = false;
        notifyListeners();
        return true;
      }

      final itemRows = await db.query(
        'items',
        where: 'id = ? AND deleted_at IS NULL',
        whereArgs: [itemId],
        limit: 1,
      );
      if (itemRows.isEmpty) {
        _errorCode = 'NOT_FOUND';
        _errorMessage = 'الصنف غير موجود في المخزون المحلي.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      final itemRow = itemRows.first;
      final unit = itemRow['unit']?.toString() ?? 'حبة';
      final availableQty = (itemRow['quantity'] as num?)?.toDouble() ?? 0.0;

      if (!ItemModel.isWeightUnitName(unit) &&
          (quantity - quantity.roundToDouble()).abs() > 1e-6) {
        _errorCode = 'VALIDATION_ERROR';
        _errorMessage = 'هذا الصنف يُقاس بـ ($unit) ولا يقبل الكسور.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      if (quantity > availableQty + 1e-6) {
        _errorCode = 'INSUFFICIENT_STOCK';
        _errorMessage = 'الكمية التالفة تتجاوز المخزون المتوفر.';
        _isLoading = false;
        notifyListeners();
        return false;
      }

      final nextQty = ((availableQty - quantity) * 1000).roundToDouble() / 1000.0;

      await db.transaction((txn) async {
        await txn.update(
          'items',
          {'quantity': nextQty < 0 ? 0.0 : nextQty},
          where: 'id = ?',
          whereArgs: [itemId],
        );

        await AppDatabase.enqueueOperation(
          txn,
          clientOpId: opId,
          opType: 'DAMAGED_GOODS',
          payload: payload,
        );
      });

      _lastOperationQueuedOffline = true;
      await _loadOfflineInventory(storeOwnerId);
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
