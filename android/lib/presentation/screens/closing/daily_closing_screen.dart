import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/daily_closing_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة المطابقة اليومية والإغلاق — الشاشة 16 (DAILY_CLOSING / 16-daily-closing.jpg)
class DailyClosingScreen extends StatefulWidget {
  const DailyClosingScreen({super.key});

  @override
  State<DailyClosingScreen> createState() => _DailyClosingScreenState();
}

class _DailyClosingScreenState extends State<DailyClosingScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  final _cashController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DailyClosingProvider>().fetchTodayClosing();
    });
  }

  @override
  void dispose() {
    _cashController.dispose();
    super.dispose();
  }

  void _showWorkerCashDialog(String workerId, String workerName, double? currentActual) {
    final controller = TextEditingController(text: currentActual?.toString() ?? '');

    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: Text('إدخال كاش العامل: $workerName', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          content: TextField(
            controller: controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'الكاش الفعلي في الدرج (ريال)'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: () async {
                final cash = double.tryParse(controller.text) ?? 0.0;
                Navigator.pop(ctx);
                final prov = context.read<DailyClosingProvider>();
                final ok = await prov.updateWorkerCash(workerId, cash);
                if (ok && mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('تم حفظ كاش العامل بنجاح')),
                  );
                }
              },
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final closingProv = context.watch<DailyClosingProvider>();
    final auth = context.watch<AuthProvider>();
    final data = closingProv.closing;
    final isOwner = auth.isOwner;
    final isClosed = data?.isClosed ?? false;

    return AppScaffold(
      title: 'المطابقة والإغلاق اليومي',
      body: closingProv.isLoading
          ? const Center(child: CircularProgressIndicator())
          : data == null
              ? const Center(child: Text('تعذر تحميل بيانات الإغلاق'))
              : RefreshIndicator(
                  onRefresh: () => context.read<DailyClosingProvider>().fetchTodayClosing(),
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // شريط حالة الإغلاق
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        decoration: BoxDecoration(
                          color: isClosed ? AppColors.cashGreen.withOpacity(0.12) : AppColors.primary.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: isClosed ? AppColors.cashGreen : AppColors.primary.withOpacity(0.3)),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              isClosed ? 'حالة اليوم: معتمد ومغلق ✅' : 'حالة اليوم: مفتوح للعمليات',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                                color: isClosed ? AppColors.cashGreen : AppColors.primary,
                              ),
                            ),
                            Text(data.closingDate, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // بطاقات المطابقة المالية: المتوقع vs الفعلي vs الفرق
                      Row(
                        children: [
                          Expanded(
                            child: _metricCard('المتوقع بالنظام', _currencyFormat.format(data.expectedCash), AppColors.primary),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _metricCard(
                              'الفعلي المحسوب',
                              data.actualCash != null ? _currencyFormat.format(data.actualCash) : 'لم يُدخل',
                              AppColors.cashGreen,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _metricCard(
                              'فرق اليوم',
                              data.difference != null ? _currencyFormat.format(data.difference) : '0',
                              (data.difference ?? 0) < 0 ? AppColors.lossRed : AppColors.primary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),

                      // جدول كاش العمال الفعلي
                      const Text(
                        'كاش العمال في الدرج (المطابقة)',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.primary),
                      ),
                      const SizedBox(height: 10),

                      ...data.workers.map((w) {
                        final workerId = w['worker_id'] ?? '';
                        final workerName = w['worker_name'] ?? 'عامل';
                        final double? actual = (w['actual_cash'] as num?)?.toDouble();
                        final double expected = (w['expected_cash'] as num?)?.toDouble() ?? 0.0;

                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: AppColors.secondary.withOpacity(0.2),
                              child: const Icon(Icons.person, color: AppColors.primary),
                            ),
                            title: Text(workerName, style: const TextStyle(fontWeight: FontWeight.bold)),
                            subtitle: Text('المتوقع: ${_currencyFormat.format(expected)} ريال'),
                            trailing: isClosed
                                ? Text(
                                    actual != null ? '${_currencyFormat.format(actual)} ريال' : 'غير مسجل',
                                    style: const TextStyle(fontWeight: FontWeight.bold),
                                  )
                                : ElevatedButton(
                                    style: ElevatedButton.styleFrom(
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                    ),
                                    onPressed: () => _showWorkerCashDialog(workerId, workerName, actual),
                                    child: Text(actual != null ? _currencyFormat.format(actual) : 'إدخال الكاش'),
                                  ),
                          ),
                        );
                      }),
                      const SizedBox(height: 24),

                      // زر اعتماد الإغلاق اليومي (حصري للمالك)
                      if (isOwner && !isClosed)
                        ElevatedButton.icon(
                          icon: const Icon(Icons.check_circle_outline),
                          label: const Text('اعتماد الإغلاق اليومي وترحيل القيود (R-36)', style: TextStyle(fontSize: 15)),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.primary,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                          onPressed: () async {
                            final ok = await closingProv.approveClosing();
                            if (ok && mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('تم اعتماد الإغلاق اليومي بنجاح 🔒')),
                              );
                            }
                          },
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _metricCard(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: color),
          ),
          const Text('ريال', style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ],
      ),
    );
  }
}
