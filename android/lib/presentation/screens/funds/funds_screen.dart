import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة موقف الأموال والمحافظ الإلكترونية — الشاشات 9 و17 (FUNDS / WALLETS_TOTAL)
class FundsScreen extends StatefulWidget {
  const FundsScreen({super.key});

  @override
  State<FundsScreen> createState() => _FundsScreenState();
}

class _FundsScreenState extends State<FundsScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  bool _isLoading = true;
  Map<String, dynamic>? _fundsData;

  @override
  void initState() {
    super.initState();
    _fetchFunds();
  }

  Future<void> _fetchFunds() async {
    setState(() => _isLoading = true);
    try {
      final api = ApiClient();
      final res = await api.get(ApiEndpoints.fundsSummary);
      setState(() {
        _fundsData = res.data;
        _isLoading = false;
      });
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final double safeCash = (_fundsData?['safe_cash'] as num?)?.toDouble() ?? 0.0;
    final double electronic = (_fundsData?['electronic_wallets'] as num?)?.toDouble() ?? 0.0;
    final double receivables = (_fundsData?['receivables'] as num?)?.toDouble() ?? 0.0;
    final double totalFunds = (_fundsData?['total_funds'] as num?)?.toDouble() ?? 0.0;

    return AppScaffold(
      title: 'موقف الأموال والصندوق',
      currentBottomNavIndex: 4,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _fetchFunds,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // بطاقة إجمالي الأموال الكلي
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [AppColors.primaryDark, AppColors.primary],
                        begin: Alignment.topRight,
                        end: Alignment.bottomLeft,
                      ),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('إجمالي الأموال والسيولة المتاحة', style: TextStyle(color: AppColors.surfaceMuted, fontSize: 13)),
                        const SizedBox(height: 8),
                        Text(
                          '${_currencyFormat.format(totalFunds)} ريال',
                          style: const TextStyle(color: AppColors.secondary, fontSize: 28, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),

                  // تفصيل الأموال: الصندوق، المحافظ، الذمم
                  _fundItem(
                    title: 'الصندوق (نقد سائل - حساب 1000)',
                    amount: safeCash,
                    icon: Icons.payments_outlined,
                    color: AppColors.cashGreen,
                  ),
                  const SizedBox(height: 10),

                  _fundItem(
                    title: 'المحافظ الإلكترونية (حساب 1100)',
                    amount: electronic,
                    icon: Icons.account_balance_wallet_outlined,
                    color: AppColors.electronicBlue,
                  ),
                  const SizedBox(height: 10),

                  _fundItem(
                    title: 'الذمم المدينة والآجل (حساب 1200)',
                    amount: receivables,
                    icon: Icons.credit_card_outlined,
                    color: AppColors.creditOrange,
                  ),
                ],
              ),
            ),
    );
  }

  Widget _fundItem({
    required String title,
    required double amount,
    required IconData icon,
    required Color color,
  }) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withOpacity(0.15),
          child: Icon(icon, color: color),
        ),
        title: Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
        trailing: Text(
          '${_currencyFormat.format(amount)} ريال',
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: color),
        ),
      ),
    );
  }
}
