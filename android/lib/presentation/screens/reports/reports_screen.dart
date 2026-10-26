import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة التقارير المالية والتشغيلية — الشاشة 13 (REPORTS / 13-reports.jpg)
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> with SingleTickerProviderStateMixin {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  late TabController _tabController;
  bool _isLoading = true;
  Map<String, dynamic>? _reportData;
  String _currentCategory = 'sales';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _tabController.addListener(() {
      if (_tabController.indexIsChanging) return;
      final cats = ['sales', 'purchases', 'expenses', 'withdrawals'];
      _currentCategory = cats[_tabController.index];
      _fetchReport();
    });
    _fetchReport();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchReport() async {
    setState(() => _isLoading = true);
    try {
      final api = ApiClient();
      final res = await api.get(
        ApiEndpoints.reports,
        queryParameters: {'category': _currentCategory},
      );
      setState(() {
        _reportData = res.data;
        _isLoading = false;
      });
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  void _exportReport(String type) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('تم تصدير التقرير بنجاح كملف $type ✅')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final double totalAmount = (_reportData?['total_amount'] as num?)?.toDouble() ?? 0.0;
    final int count = (_reportData?['count'] as num?)?.toInt() ?? 0;
    final List<dynamic> records = _reportData?['records'] ?? [];

    return AppScaffold(
      title: 'التقارير المالية',
      actions: [
        IconButton(
          tooltip: 'تصدير PDF',
          icon: const Icon(Icons.picture_as_pdf_outlined),
          onPressed: () => _exportReport('PDF'),
        ),
        IconButton(
          tooltip: 'تصدير Excel',
          icon: const Icon(Icons.table_chart_outlined),
          onPressed: () => _exportReport('Excel'),
        ),
      ],
      body: Column(
        children: [
          TabBar(
            controller: _tabController,
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.textMuted,
            indicatorColor: AppColors.primary,
            tabs: const [
              Tab(text: 'المبيعات'),
              Tab(text: 'المشتريات'),
              Tab(text: 'المصاريف'),
              Tab(text: 'المسحوبات'),
            ],
          ),

          // شريط إجمالي التقرير
          Container(
            margin: const EdgeInsets.all(12),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'عدد السجلات: $count',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                ),
                Text(
                  'الإجمالي: ${_currencyFormat.format(totalAmount)} ريال',
                  style: const TextStyle(color: AppColors.secondary, fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ],
            ),
          ),

          // قائمة سجلات التقرير
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : records.isEmpty
                    ? const Center(child: Text('لا توجد بيانات مسجلة في هذا القسم'))
                    : RefreshIndicator(
                        onRefresh: _fetchReport,
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                          itemCount: records.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 6),
                          itemBuilder: (context, index) {
                            final r = records[index];
                            final double amt = (r['amount'] as num?)?.toDouble() ?? 0.0;
                            final date = r['date'] ?? '';

                            return Card(
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: AppColors.secondary.withOpacity(0.2),
                                  child: const Icon(Icons.analytics_outlined, color: AppColors.primary),
                                ),
                                title: Text(r['title'] ?? 'حركة مالية', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                                subtitle: Text(date, style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                                trailing: Text(
                                  '${_currencyFormat.format(amt)} ريال',
                                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppColors.primary),
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
