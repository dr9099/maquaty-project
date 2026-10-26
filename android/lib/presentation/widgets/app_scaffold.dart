import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../providers/auth_provider.dart';

/// الهيكل الرئيسي لشاشات التطبيق مع فرض اتجاه RTL وقائمة جانبية وشريط تنقل سفلي مُفلترين حسب الدور
class AppScaffold extends StatelessWidget {
  final String title;
  final Widget body;
  final Widget? floatingActionButton;
  final List<Widget>? actions;
  final int? currentBottomNavIndex;

  const AppScaffold({
    super.key,
    required this.title,
    required this.body,
    this.floatingActionButton,
    this.actions,
    this.currentBottomNavIndex,
  });

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canFunds = auth.canViewFunds;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Text(title),
          actions: [
            ...?actions,
            IconButton(
              tooltip: 'المزامنة',
              icon: const Icon(Icons.sync, size: 20),
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('جاري المزامنة في الخلفية...')),
                );
              },
            ),
          ],
        ),
        drawer: _buildDrawer(context, auth),
        body: SafeArea(child: body),
        floatingActionButton: floatingActionButton,
        bottomNavigationBar: currentBottomNavIndex != null
            ? _buildBottomNav(context, canFunds, currentBottomNavIndex!)
            : null,
      ),
    );
  }

  Widget _buildDrawer(BuildContext context, AuthProvider auth) {
    final account = auth.currentAccount;
    final isOwner = auth.isOwner;
    final isResp = auth.isResponsibleWorker;

    return Drawer(
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: Column(
          children: [
            UserAccountsDrawerHeader(
              decoration: const BoxDecoration(color: AppColors.primary),
              currentAccountPicture: CircleAvatar(
                backgroundColor: AppColors.secondary,
                child: Text(
                  account?.displayName.isNotEmpty == true
                      ? account!.displayName.substring(0, 1)
                      : 'م',
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: AppColors.primaryDark,
                  ),
                ),
              ),
              accountName: Text(
                account?.displayName ?? 'مستخدم',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              accountEmail: Text(
                '${account?.storeName ?? "متجر مَقوتي"} · ${isOwner ? "مالك المتجر" : isResp ? "عامل مسؤول" : "عامل"}',
                style: const TextStyle(fontSize: 13, color: AppColors.surfaceMuted),
              ),
            ),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  _drawerItem(context, Icons.home_outlined, 'الرئيسية', '/home'),
                  _drawerItem(context, Icons.point_of_sale_outlined, 'البيع', '/sell'),
                  _drawerItem(context, Icons.inventory_2_outlined, 'المخزون', '/inventory'),
                  _drawerItem(context, Icons.receipt_long_outlined, 'المباع اليوم', '/sold-items'),
                  _drawerItem(context, Icons.history_outlined, 'سجل العمليات والمرتجع', '/operations-log'),

                  if (auth.canManageCredit)
                    _drawerItem(context, Icons.credit_card_outlined, 'الآجل والعملاء', '/credit'),

                  if (isOwner || auth.canEnterOwnAdvance)
                    _drawerItem(context, Icons.account_balance_wallet_outlined, 'المصروفات والسلف', '/expenses'),

                  if (auth.canViewFunds)
                    _drawerItem(context, Icons.attach_money_outlined, 'الأموال والصندوق', '/funds'),

                  if (auth.canViewReports)
                    _drawerItem(context, Icons.bar_chart_outlined, 'التقارير', '/reports'),

                  if (auth.canRecordDamagedGoods)
                    _drawerItem(context, Icons.report_problem_outlined, 'تسجيل تالف', '/damaged-goods'),

                  if (isResp)
                    _drawerItem(context, Icons.people_outline, 'العمال المدارين', '/managed-workers'),

                  if (isOwner) ...[
                    const Divider(),
                    _drawerItem(context, Icons.badge_outlined, 'إدارة العمال', '/workers'),
                    _drawerItem(context, Icons.rule_folder_outlined, 'معالجة العمليات المرفوضة', '/rejected-transactions'),
                  ],

                  const Divider(),
                  _drawerItem(context, Icons.fact_check_outlined, 'المطابقة والإغلاق اليومي', '/daily-closing'),
                  _drawerItem(context, Icons.cloud_sync_outlined, 'النسخ الاحتياطي', '/backup'),
                ],
              ),
            ),

            // قسم تبديل الحسابات للمالك فقط في الأسفل تماماً (R-35 / docs/09-mobile-app.md §8)
            if (isOwner)
              ListTile(
                leading: const Icon(Icons.switch_account_outlined, color: AppColors.primary),
                title: const Text('تبديل الحسابات'),
                onTap: () {
                  Navigator.pop(context);
                  _showAccountSwitcher(context, auth);
                },
              ),

            ListTile(
              leading: const Icon(Icons.logout, color: AppColors.lossRed),
              title: const Text('تسجيل الخروج', style: TextStyle(color: AppColors.lossRed)),
              onTap: () async {
                Navigator.pop(context);
                await auth.logout();
                if (context.mounted) {
                  Navigator.pushNamedAndRemoveUntil(context, '/login', (route) => false);
                }
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _drawerItem(BuildContext context, IconData icon, String title, String route) {
    return ListTile(
      leading: Icon(icon, color: AppColors.primary),
      title: Text(title, style: const TextStyle(fontSize: 14)),
      onTap: () {
        Navigator.pop(context);
        Navigator.pushNamed(context, route);
      },
    );
  }

  Widget _buildBottomNav(BuildContext context, bool canFunds, int activeIndex) {
    // 5 عناصر: أموال (للمالك والمسؤول فقط)، سجل، مباع، مخزون، بيع (docs/09-mobile-app.md §2)
    final items = <BottomNavigationBarItem>[
      const BottomNavigationBarItem(icon: Icon(Icons.point_of_sale), label: 'بيع'),
      const BottomNavigationBarItem(icon: Icon(Icons.inventory_2), label: 'مخزون'),
      const BottomNavigationBarItem(icon: Icon(Icons.receipt_long), label: 'مباع'),
      const BottomNavigationBarItem(icon: Icon(Icons.history), label: 'سجل'),
      if (canFunds)
        const BottomNavigationBarItem(icon: Icon(Icons.attach_money), label: 'أموال'),
    ];

    return BottomNavigationBar(
      type: BottomNavigationBarType.fixed,
      currentIndex: activeIndex.clamp(0, items.length - 1),
      selectedItemColor: AppColors.primary,
      unselectedItemColor: AppColors.textMuted,
      selectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
      unselectedLabelStyle: const TextStyle(fontSize: 11),
      items: items,
      onTap: (index) {
        if (index == activeIndex) return;
        if (index == 0) Navigator.pushReplacementNamed(context, '/sell');
        if (index == 1) Navigator.pushReplacementNamed(context, '/inventory');
        if (index == 2) Navigator.pushReplacementNamed(context, '/sold-items');
        if (index == 3) Navigator.pushReplacementNamed(context, '/operations-log');
        if (index == 4 && canFunds) Navigator.pushReplacementNamed(context, '/funds');
      },
    );
  }

  void _showAccountSwitcher(BuildContext context, AuthProvider auth) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'تبديل الحسابات المحفوظة (R-35)',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.primary),
              ),
              const SizedBox(height: 12),
              ...auth.accounts.map((acc) {
                final isCurrent = acc.id == auth.currentAccount?.id;
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: isCurrent ? AppColors.secondary : AppColors.surfaceMuted,
                    child: Text(acc.displayName.isNotEmpty ? acc.displayName.substring(0, 1) : 'م'),
                  ),
                  title: Text(acc.displayName),
                  subtitle: Text('${acc.storeName} (${acc.phone})'),
                  trailing: isCurrent
                      ? const Icon(Icons.check_circle, color: AppColors.cashGreen)
                      : null,
                  onTap: () async {
                    Navigator.pop(ctx);
                    if (!isCurrent) {
                      await auth.switchAccount(acc.id);
                      if (context.mounted) {
                        Navigator.pushNamedAndRemoveUntil(context, '/home', (r) => false);
                      }
                    }
                  },
                );
              }),
            ],
          ),
        ),
      ),
    );
  }
}
