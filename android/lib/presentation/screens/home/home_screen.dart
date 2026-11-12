import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/dashboard_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';

/// الشاشة الرئيسية — الشاشة 3 (HOME / 03-home.jpg)
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      context.read<DashboardProvider>().fetchSummary();
      final settings = context.read<StoreSettingsProvider>();
      await settings.fetchSettings();
      if (mounted) {
        context
            .read<AuthProvider>()
            .syncAllowResponsiblePurchases(settings.allowResponsiblePurchases);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final dashboard = context.watch<DashboardProvider>();
    final settings = context.watch<StoreSettingsProvider>();
    final account = auth.currentAccount;
    final summary = dashboard.summary;
    final isClosed = summary?.dayStatus == 'CLOSED';
    final currencyUnit = summary?.currencySymbol.isNotEmpty == true
        ? summary!.currencySymbol
        : settings.currencySymbol;

    return AppScaffold(
      title: 'الرئيسية',
      currentBottomNavIndex: 0,
      body: RefreshIndicator(
        onRefresh: () => context.read<DashboardProvider>().fetchSummary(),
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          children: [
            // ترويسة الترحيب والشعار (03-home.jpg)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'صباح الخير',
                          style: TextStyle(
                            fontSize: 14,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          account?.displayName.isNotEmpty == true
                              ? 'مرحباً بك، ${account!.displayName}'
                              : 'مرحباً بك في مَقوتي',
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  // شعار التطبيق مَقوتي (03-home.jpg)
                  Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.primary.withOpacity(0.18),
                          blurRadius: 8,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Image.asset(
                      'assets/images/logo.png',
                      fit: BoxFit.cover,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // بطاقات الأرقام المالية (الصندوق ومبيعات اليوم)
            Row(
              children: [
                Expanded(
                  child: _buildMetricCard(
                    title: 'الصندوق (نقد)',
                    value: summary != null ? _currencyFormat.format(summary.todayCash) : '...',
                    unit: currencyUnit,
                    icon: Icons.payments_outlined,
                    color: AppColors.cashGreen,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildMetricCard(
                    title: 'مبيعات اليوم',
                    value: summary != null ? _currencyFormat.format(summary.totalSales) : '...',
                    unit: currencyUnit,
                    icon: Icons.trending_up,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
            if (auth.canManagePurchases && summary?.purchasesTodayTotal != null) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _buildMetricCard(
                      title: 'مشتريات اليوم',
                      value: _currencyFormat.format(summary!.purchasesTodayTotal ?? 0),
                      unit: currencyUnit,
                      icon: Icons.shopping_bag_outlined,
                      color: AppColors.electronicBlue,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildMetricCard(
                      title: 'مستحقات الموردين',
                      value: _currencyFormat.format(summary.supplierPayablesTotal ?? 0),
                      unit: currencyUnit,
                      icon: Icons.local_shipping_outlined,
                      color: AppColors.creditOrange,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 20),

            // شبكة الوصول السريع (3x2 Quick Access Grid)
            const Text(
              'الوصول السريع',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 12),

            GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: 3,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio: 1.05,
              children: [
                _buildQuickAction(
                  icon: Icons.point_of_sale,
                  label: 'بيع سريع',
                  color: AppColors.primary,
                  onTap: () => Navigator.pushNamed(context, '/sell'),
                ),
                _buildQuickAction(
                  icon: Icons.inventory_2_outlined,
                  label: 'المخزون',
                  color: AppColors.accent,
                  onTap: () => Navigator.pushNamed(context, '/inventory'),
                ),
                if (auth.canRecordDamagedGoods)
                  _buildQuickAction(
                    icon: Icons.report_problem_outlined,
                    label: 'تسجيل تالف',
                    color: AppColors.lossRed,
                    onTap: () => Navigator.pushNamed(context, '/damaged-goods'),
                  ),
                if (auth.canManageCredit)
                  _buildQuickAction(
                    icon: Icons.credit_card_outlined,
                    label: 'الآجل',
                    color: AppColors.creditOrange,
                    onTap: () => Navigator.pushNamed(context, '/credit'),
                  ),
                if (auth.isOwner || auth.canEnterOwnAdvance)
                  _buildQuickAction(
                    icon: Icons.receipt_long_outlined,
                    label: 'المصروفات',
                    color: AppColors.electronicBlue,
                    onTap: () => Navigator.pushNamed(context, '/expenses'),
                  ),
                if (auth.canManagePurchases)
                  _buildQuickAction(
                    icon: Icons.shopping_bag_outlined,
                    label: 'المشتريات',
                    color: AppColors.primaryDark,
                    onTap: () => Navigator.pushNamed(context, '/purchases'),
                  ),
                if (auth.canManageSuppliers)
                  _buildQuickAction(
                    icon: Icons.local_shipping_outlined,
                    label: 'الموردون',
                    color: AppColors.creditOrange,
                    onTap: () => Navigator.pushNamed(context, '/suppliers'),
                  ),
                if (auth.canViewReports)
                  _buildQuickAction(
                    icon: Icons.bar_chart,
                    label: 'التقارير',
                    color: AppColors.primary,
                    onTap: () => Navigator.pushNamed(context, '/reports'),
                  ),
                if (auth.isOwner)
                  _buildQuickAction(
                    icon: Icons.menu_book_outlined,
                    label: 'دفتر الأستاذ',
                    color: AppColors.primaryDark,
                    onTap: () => Navigator.pushNamed(context, '/accounting/ledger'),
                  ),
              ],
            ),
            const SizedBox(height: 20),

            // بطاقة الإغلاق اليومي والمطابقة
            Card(
              child: ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.fact_check_outlined, color: AppColors.primary),
                ),
                title: const Text('المطابقة والإغلاق اليومي', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                subtitle: Text(
                  isClosed ? 'تم اعتماد إغلاق اليوم بنجاح' : 'مطابقة الكاش الفعلي مع المتوقع واعتماد الإغلاق',
                  style: const TextStyle(fontSize: 12),
                ),
                trailing: const Icon(Icons.chevron_left),
                onTap: () => Navigator.pushNamed(context, '/daily-closing'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricCard({
    required String title,
    required String value,
    required String unit,
    required IconData icon,
    required Color color,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: color),
                const SizedBox(width: 6),
                Text(
                  title,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  unit,
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickAction({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(height: 8),
            Text(
              label,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: AppColors.textPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
