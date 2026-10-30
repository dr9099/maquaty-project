/// نقاط نهاية API المعتمدة لنظام مَقوتي
/// المرجع: docs/API_SPEC.md و openapi.yaml
class ApiEndpoints {
  // الرابط الافتراضي لخادم التطوير (10.0.2.2 لمشغل أندرويد الافتراضي، أو 127.0.0.1 / IP مخصص)
  static const String defaultBaseUrl = 'http://10.0.2.2:3000';

  // المصادقة والحساب
  static const String registerOwner = '/v1/auth/register-store-owner';
  static const String login = '/v1/auth/login';
  static const String refreshToken = '/v1/auth/refresh';
  static const String logout = '/v1/auth/logout';
  static const String changeTempPassword = '/v1/auth/change-temp-password';

  // المبيعات والمرتجعات
  static const String sales = '/v1/sales';
  static const String salesToday = '/v1/sales/today';
  static const String returns = '/v1/returns';

  // الأصناف والمخزون
  static const String items = '/v1/items';
  static const String inventory = '/v1/inventory';
  static const String damagedGoods = '/v1/damaged-goods';

  // المحافظ الإلكترونية وتسويتها
  static const String wallets = '/v1/wallets';
  static const String walletsTotal = '/v1/wallets/total';
  static String walletTransactions(String id) => '/v1/wallets/$id/transactions';
  static String walletSettle(String id) => '/v1/wallets/$id/settle';

  // الآجل
  static const String creditCustomers = '/v1/credit-customers';
  static String creditStatement(String id) => '/v1/credit-customers/$id/statement';
  static String creditPayments(String id) => '/v1/credit-customers/$id/payments';

  // العمال
  static const String workers = '/v1/workers';
  static const String managedWorkers = '/v1/managed-workers';
  static String workerDetails(String id) => '/v1/workers/$id';

  // المصروفات والسلف والمستحقات
  static const String expenses = '/v1/expenses';
  static const String expenseCategories = '/v1/expenses/categories';
  static const String expensesRent = '/v1/expenses/rent';
  static const String expensesUtilities = '/v1/expenses/utilities';
  static const String expensesSalaries = '/v1/expenses/salaries';
  static const String expensesAccrualsSettle = '/v1/expenses/accruals/settle';
  static const String employees = '/v1/employees';
  static const String workerAdvances = '/v1/worker-advances';

  // الإغلاق اليومي
  static const String dailyClosingToday = '/v1/daily-closings/today';
  static String dailyClosingUpdate(String id) => '/v1/daily-closings/$id';
  static String dailyClosingApprove(String id) => '/v1/daily-closings/$id/approve';
  static String dailyClosingWorkerCash(String id, String workerId) =>
      '/v1/daily-closings/$id/workers/$workerId/cash';

  // لوحة الملخص والأموال وجاري المالك والتقارير
  static const String dashboardSummary = '/v1/dashboard/summary';
  static const String fundsSummary = '/v1/funds/summary';
  static const String ownerTransactions = '/v1/funds/owner-transactions';
  static const String reports = '/v1/reports';
  static const String reportsPurchasesBySupplier = '/v1/reports/purchases-by-supplier';
  static const String reportsPurchasesByItem = '/v1/reports/purchases-by-item';
  static const String reportsSupplierPayables = '/v1/reports/supplier-payables';
  static const String reportsProfitMargin = '/v1/reports/profit-margin';

  // المحاسبة ودفتر الأستاذ العام (للمالك فقط)
  static const String accountingAccounts = '/v1/accounting/accounts';
  static const String accountingLedger = '/v1/accounting/ledger';

  // إعدادات المتجر (العملة الموحدة وطريقة احتساب التكلفة وصلاحيات العامل المسؤول)
  static const String storeSettings = '/v1/settings/store';

  // الموردون وحساباتهم وسداد الدفعات (للمالك أو للعامل المسؤول عند التفعيل)
  static const String suppliers = '/v1/suppliers';
  static String supplierById(String id) => '/v1/suppliers/$id';
  static String supplierPayments(String id) => '/v1/suppliers/$id/payments';
  static String supplierStatement(String id) => '/v1/suppliers/$id/statement';
  static String supplierAging(String id) => '/v1/suppliers/$id/aging';

  // فواتير المشتريات ومرتجعات الشراء وفحص التكلفة (للمالك أو للعامل المسؤول عند التفعيل)
  static const String purchases = '/v1/purchases';
  static const String purchasePreviewCosting = '/v1/purchases/preview-costing';
  static String purchaseById(String id) => '/v1/purchases/$id';
  static String purchasePost(String id) => '/v1/purchases/$id/post';
  static String purchaseVoid(String id) => '/v1/purchases/$id/void';
  static String purchaseReturns(String id) => '/v1/purchases/$id/returns';

  // محرك المزامنة والأجهزة والعمليات المرفوضة
  static const String deviceSync = '/v1/device/sync';
  static const String broadcastsPull = '/v1/device/broadcasts/pull';
  static String broadcastAck(String id) => '/v1/device/broadcasts/$id/ack';
  static const String rejectedTransactions = '/v1/rejected-transactions';
  static String resolveRejectedTransaction(String id) =>
      '/v1/rejected-transactions/$id/resolve';
}
