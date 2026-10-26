import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/dashboard_provider.dart';
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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardProvider>().fetchSummary();
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final dashboard = context.watch<DashboardProvider>();
    final account = auth.currentAccount;
    final summary = dashboard.summary;
    final isClosed = summary?.dayStatus == 'CLOSED';

    return AppScaffold(
      title: 'الرئيسية',
      currentBottomNavIndex: 0,
      body: RefreshIndicator(
        onRefresh: () => context.read<DashboardProvider>().fetchSummary(),
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          children: [
            // بطاقة الترحيب
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.secondary,
                    child: const Icon(Icons.storefront, color: AppColors.primaryDark),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'أهلاً بك، ${account?.displayName ?? "المستخدم"}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          account?.storeName ?? 'متجر مَقوتي',
                          style: const TextStyle(color: AppColors.surfaceMuted, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                  // مؤشر حالة اليوم
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: isClosed
                          ? AppColors.lossRed.withOpacity(0.2)
                          : AppColors.secondary.withOpacity(0.25),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      isClosed ? 'اليوم مغلق' : 'اليوم مفتوح',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: isClosed ? AppColors.lossRed : AppColors.secondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // بطاقات الأرقام المالية (الصندوق ومبيعات اليوم)
            Row(
              children: [
                Expanded(
                  child: _buildMetricCard(
                    title: 'الصندوق (نقد)',
                    value: summary != null ? _currencyFormat.format(summary.todayCash) : '...',
                    unit: 'ريال',
                    icon: Icons.payments_outlined,
                    color: AppColors.cashGreen,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildMetricCard(
                    title: 'مبيعات اليوم',
                    value: summary != null ? _currencyFormat.format(summary.totalSales) : '...',
                    unit: 'ريال',
                    icon: Icons.trending_up,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
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
                if (auth.canViewReports)
                  _buildQuickAction(
                    icon: Icons.bar_chart,
                    label: 'التقارير',
                    color: AppColors.primary,
                    onTap: () => Navigator.pushNamed(context, '/reports'),
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
                title: const Text('المطابقة والإغلاق اليومي (R-36)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
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
