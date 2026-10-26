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

  // المحافظ الإلكترونية
  static const String wallets = '/v1/wallets';
  static const String walletsTotal = '/v1/wallets/total';

  // الآجل
  static const String creditCustomers = '/v1/credit-customers';
  static String creditStatement(String id) => '/v1/credit-customers/$id/statement';
  static String creditPayments(String id) => '/v1/credit-customers/$id/payments';

  // العمال
  static const String workers = '/v1/workers';
  static const String managedWorkers = '/v1/workers/managed';
  static String workerDetails(String id) => '/v1/workers/$id';

  // المصروفات والسلف
  static const String expenses = '/v1/expenses';
  static const String expenseCategories = '/v1/expenses/categories';
  static const String employees = '/v1/employees';
  static const String workerAdvances = '/v1/expenses/worker-advances';

  // الإغلاق اليومي
  static const String dailyClosingToday = '/v1/daily-closing/today';
  static String dailyClosingApprove(String id) => '/v1/daily-closing/$id/approve';
  static String dailyClosingWorkerCash(String id, String workerId) =>
      '/v1/daily-closing/$id/workers/$workerId/cash';

  // لوحة الملخص والأموال والتقارير
  static const String dashboardSummary = '/v1/dashboard/summary';
  static const String fundsSummary = '/v1/funds/summary';
  static const String reports = '/v1/reports';

  // محرك المزامنة والأجهزة والعمليات المرفوضة
  static const String deviceSync = '/v1/device/sync';
  static const String broadcastsPull = '/v1/device/broadcasts/pull';
  static String broadcastAck(String id) => '/v1/device/broadcasts/$id/ack';
  static const String rejectedTransactions = '/v1/rejected-transactions';
  static String resolveRejectedTransaction(String id) =>
      '/v1/rejected-transactions/$id/resolve';
}
