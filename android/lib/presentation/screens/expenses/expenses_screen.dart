import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة المصروفات وسلف العمال — الشاشة 12 (EXPENSES / 12-expenses.jpg)
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> with SingleTickerProviderStateMixin {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  late TabController _tabController;
  bool _isLoading = true;
  List<dynamic> _expenses = [];

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    final tabCount = auth.isOwner ? 3 : 1;
    _tabController = TabController(length: tabCount, vsync: this);
    _fetchExpenses();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchExpenses() async {
    setState(() => _isLoading = true);
    try {
      final api = ApiClient();
      final res = await api.get(ApiEndpoints.expenses);
      setState(() {
        _expenses = res.data ?? [];
        _isLoading = false;
      });
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  void _showAddExpenseDialog() {
    final amountController = TextEditingController();
    final descController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تسجيل مصروف جديد', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: amountController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'المبلغ (ريال)'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: descController,
                decoration: const InputDecoration(labelText: 'بيان / تفاصيل المصروف'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
            ElevatedButton(
              onPressed: () async {
                final amt = double.tryParse(amountController.text) ?? 0.0;
                final desc = descController.text.trim();
                if (amt <= 0 || desc.isEmpty) return;

                Navigator.pop(ctx);
                try {
                  final api = ApiClient();
                  await api.post(ApiEndpoints.expenses, data: {
                    'amount': amt,
                    'description': desc,
                    'category': 'SERVICES',
                    'paymentMethod': 'CASH',
                  });
                  _fetchExpenses();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                }
              },
              child: const Text('حفظ المصروف'),
            ),
          ],
        ),
      ),
    );
  }

  void _showRecordAdvanceDialog() {
    final amountController = TextEditingController();
    final noteController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تسجيل سلفة شخصية (سلفتي)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: amountController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'مبلغ السلفة (ريال)'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: noteController,
                decoration: const InputDecoration(labelText: 'ملاحظة (اختياري)'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
            ElevatedButton(
              onPressed: () async {
                final amt = double.tryParse(amountController.text) ?? 0.0;
                if (amt <= 0) return;

                Navigator.pop(ctx);
                try {
                  final api = ApiClient();
                  await api.post(ApiEndpoints.workerAdvances, data: {
                    'amount': amt,
                    'note': noteController.text.trim(),
                  });
                  _fetchExpenses();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                }
              },
              child: const Text('تسجيل السلفة'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isOwner = auth.isOwner;

    return AppScaffold(
      title: 'المصروفات والسلف',
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        onPressed: isOwner ? _showAddExpenseDialog : _showRecordAdvanceDialog,
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          TabBar(
            controller: _tabController,
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.textMuted,
            indicatorColor: AppColors.primary,
            tabs: isOwner
                ? const [
                    Tab(text: 'خدمات وفواتير'),
                    Tab(text: 'إيجارات'),
                    Tab(text: 'أجور وسلف (R-37)'),
                  ]
                : const [
                    Tab(text: 'سلفتي (سلف شخصية)'),
                  ],
          ),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _expenses.isEmpty
                    ? const Center(child: Text('لا توجد مصروفات مسجلة مؤخراً'))
                    : RefreshIndicator(
                        onRefresh: _fetchExpenses,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _expenses.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final ex = _expenses[index];
                            final double amount = (ex['amount'] as num?)?.toDouble() ?? 0.0;
                            final desc = ex['description'] ?? 'مصروف';
                            final category = ex['category'] ?? '';

                            return Card(
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: AppColors.electronicBlue.withOpacity(0.15),
                                  child: const Icon(Icons.receipt_outlined, color: AppColors.electronicBlue),
                                ),
                                title: Text(desc, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                                subtitle: Text('التصنيف: $category'),
                                trailing: Text(
                                  '${_currencyFormat.format(amount)} ريال',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                    color: AppColors.primary,
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}
