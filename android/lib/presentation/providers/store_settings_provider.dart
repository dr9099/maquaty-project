import 'package:flutter/foundation.dart';
import '../../core/constants/api_endpoints.dart';
import '../../core/network/api_client.dart';

class CostingOptionInfo {
  final String code;
  final String labelAr;
  final String descriptionAr;

  const CostingOptionInfo({
    required this.code,
    required this.labelAr,
    required this.descriptionAr,
  });

  factory CostingOptionInfo.fromJson(Map<String, dynamic> json) {
    return CostingOptionInfo(
      code: (json['code'] ?? 'WEIGHTED_AVERAGE').toString(),
      labelAr: (json['label_ar'] ?? '').toString(),
      descriptionAr: (json['description_ar'] ?? '').toString(),
    );
  }
}

class CurrencyOptionInfo {
  final String code;
  final String symbol;
  final String nameAr;

  const CurrencyOptionInfo({
    required this.code,
    required this.symbol,
    required this.nameAr,
  });

  factory CurrencyOptionInfo.fromJson(Map<String, dynamic> json) {
    return CurrencyOptionInfo(
      code: (json['code'] ?? 'YER').toString(),
      symbol: (json['symbol'] ?? 'ر.ي').toString(),
      nameAr: (json['name_ar'] ?? 'ريال يمني').toString(),
    );
  }
}

/// مزود إعدادات المتجر: العملة الموحدة للمتجر وطريقة احتساب التكلفة الافتراضية
class StoreSettingsProvider with ChangeNotifier {
  final ApiClient _api;

  String _storeName = '';
  String _currency = 'YER';
  String _currencySymbol = 'ر.ي';
  String _currencyNameAr = 'ريال يمني';
  bool _currencyLocked = false;
  String _defaultCostingMethod = 'WEIGHTED_AVERAGE';
  bool _allowResponsiblePurchases = false;
  bool _isLoading = false;
  String? _errorMessage;
  String? _errorCode;

  static const List<CurrencyOptionInfo> defaultSupportedCurrencies = [
    CurrencyOptionInfo(code: 'YER', symbol: 'ر.ي', nameAr: 'ريال يمني'),
    CurrencyOptionInfo(code: 'SAR', symbol: 'ر.س', nameAr: 'ريال سعودي'),
    CurrencyOptionInfo(code: 'USD', symbol: '\$', nameAr: 'دولار أمريكي'),
  ];

  static const List<CostingOptionInfo> defaultCostingOptions = [
    CostingOptionInfo(
      code: 'WEIGHTED_AVERAGE',
      labelAr: 'دمج الكميتين وحساب متوسط السعر تلقائياً',
      descriptionAr:
          'نجمع الكمية المتبقية مع الكمية الجديدة ونحسب سعر تكلفة وسط بين السعرين لبقية اليوم.',
    ),
    CostingOptionInfo(
      code: 'LAST_PRICE',
      labelAr: 'اعتماد السعر الجديد لكل الكمية الموجودة',
      descriptionAr:
          'نحدث سعر التكلفة فوراً على آخر سعر اشتريت به الآن لكل الكمية المتاحة.',
    ),
    CostingOptionInfo(
      code: 'FIFO',
      labelAr: 'بيع الكمية القديمة بسعرها أولاً ثم الجديدة بسعرها',
      descriptionAr:
          'نخصم المبيعات من الدفعة القديمة بتكلفتها أولاً، وبعد نفادها نبدأ بالخصم من الدفعة الجديدة بتكلفتها.',
    ),
  ];

  List<CurrencyOptionInfo> _supportedCurrencies = defaultSupportedCurrencies;
  List<CostingOptionInfo> _costingOptions = defaultCostingOptions;

  StoreSettingsProvider(this._api);

  String get storeName => _storeName;
  String get currency => _currency;
  String get currencySymbol => _currencySymbol;
  String get currencyNameAr => _currencyNameAr;
  bool get currencyLocked => _currencyLocked;
  String get defaultCostingMethod => _defaultCostingMethod;
  bool get allowResponsiblePurchases => _allowResponsiblePurchases;
  List<CurrencyOptionInfo> get supportedCurrencies => _supportedCurrencies;
  List<CostingOptionInfo> get costingOptions => _costingOptions;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  String? get errorCode => _errorCode;

  static String symbolForCurrency(String code) {
    switch (code) {
      case 'SAR':
        return 'ر.س';
      case 'USD':
        return '\$';
      case 'YER':
      default:
        return 'ر.ي';
    }
  }

  static String costingLabelAr(String? code) {
    for (final opt in defaultCostingOptions) {
      if (opt.code == code) return opt.labelAr;
    }
    return defaultCostingOptions.first.labelAr;
  }

  void applyFromJson(Map<String, dynamic> data) {
    _storeName = (data['store_name'] ?? _storeName).toString();
    _currency = (data['currency'] ?? _currency).toString();
    _currencySymbol =
        (data['currency_symbol'] ?? symbolForCurrency(_currency)).toString();
    _currencyNameAr = (data['currency_name_ar'] ?? _currencyNameAr).toString();
    if (data.containsKey('currency_locked')) {
      _currencyLocked = data['currency_locked'] == true;
    }
    if (data['default_costing_method'] != null) {
      _defaultCostingMethod = data['default_costing_method'].toString();
    }
    if (data.containsKey('allow_responsible_purchases')) {
      _allowResponsiblePurchases = data['allow_responsible_purchases'] == true;
    }
    if (data['supported_currencies'] is List) {
      _supportedCurrencies = (data['supported_currencies'] as List)
          .map((e) => CurrencyOptionInfo.fromJson(Map<String, dynamic>.from(e)))
          .toList();
    }
    if (data['costing_options'] is List) {
      _costingOptions = (data['costing_options'] as List)
          .map((e) => CostingOptionInfo.fromJson(Map<String, dynamic>.from(e)))
          .toList();
    }
  }

  Future<void> fetchSettings() async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      final res = await _api.get(ApiEndpoints.storeSettings);
      if (res.data is Map) {
        applyFromJson(Map<String, dynamic>.from(res.data));
      }
    } on ApiException catch (e) {
      _errorCode = e.code;
      _errorMessage = e.message;
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> updateSettings({
    String? currency,
    String? defaultCostingMethod,
    String? storeName,
    bool? allowResponsiblePurchases,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    _errorCode = null;
    notifyListeners();

    try {
      final payload = <String, dynamic>{
        if (currency != null) 'currency': currency,
        if (defaultCostingMethod != null)
          'defaultCostingMethod': defaultCostingMethod,
        if (storeName != null && storeName.trim().isNotEmpty)
          'storeName': storeName.trim(),
        if (allowResponsiblePurchases != null)
          'allowResponsiblePurchases': allowResponsiblePurchases,
      };
      final res = await _api.patch(ApiEndpoints.storeSettings, data: payload);
      if (res.data is Map) {
        applyFromJson(Map<String, dynamic>.from(res.data));
      }
      _isLoading = false;
      notifyListeners();
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
}

