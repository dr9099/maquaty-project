import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/sales_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة سجل العمليات والمرتجع — الشاشة 8 (OPERATIONS_LOG / 08-operations-log.jpg)
class OperationsLogScreen extends StatefulWidget {
  const OperationsLogScreen({super.key});

  @override
  State<OperationsLogScreen> createState() => _OperationsLogScreenState();
}

class _OperationsLogScreenState extends State<OperationsLogScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  final _timeFormat = DateFormat('hh:mm a', 'ar');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SalesProvider>().fetchTodaySales();
    });
  }

  void _showReturnDialog(SaleRecord sale) {
    final qtyController = TextEditingController(text: sale.quantity.toString());
    final reasonController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تسجيل مرتجع مبيعات', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('الصنف: ${sale.itemName}', style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              Text('المبلغ الأصلي: ${_currencyFormat.format(sale.amount)} ريال'),
              const SizedBox(height: 14),
              TextField(
                controller: qtyController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'الكمية المرتجعة'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: reasonController,
                decoration: const InputDecoration(labelText: 'سبب الإرجاع (إلزامي)'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.lossRed),
              onPressed: () async {
                final qty = double.tryParse(qtyController.text) ?? 0.0;
                final reason = reasonController.text.trim();

                if (qty <= 0 || reason.isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('الكمية والسبب مطلوبان')),
                  );
                  return;
                }

                Navigator.pop(ctx);
                final sales = context.read<SalesProvider>();
                final success = await sales.processReturn(
                  saleId: sale.id,
                  quantity: qty,
                  reason: reason,
                );

                if (success && mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('تم تسجيل المرتجع بنجاح وعكس القيد ✅')),
                  );
                } else if (mounted && sales.errorMessage != null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(sales.errorMessage!)),
                  );
                }
              },
              child: const Text('تأكيد الإرجاع'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final salesProvider = context.watch<SalesProvider>();
    final sales = salesProvider.todaySales;

    return AppScaffold(
      title: 'سجل العمليات اليومية',
      currentBottomNavIndex: 3,
      body: salesProvider.isLoading
          ? const Center(child: CircularProgressIndicator())
          : sales.isEmpty
              ? const Center(
                  child: Text(
                    'لا توجد عمليات بيع مسجلة اليوم',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () => context.read<SalesProvider>().fetchTodaySales(),
                  child: ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    itemCount: sales.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final sale = sales[index];
                      final isEmergency = sale.isEmergencySale;

                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    children: [
                                      Text(
                                        sale.itemName,
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                                      ),
                                      if (isEmergency) ...[
                                        const SizedBox(width: 8),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: AppColors.lossRed.withOpacity(0.12),
                                            borderRadius: BorderRadius.circular(6),
                                          ),
                                          child: const Text(
                                            'اضطراري',
                                            style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppColors.lossRed),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  Text(
                                    '${_currencyFormat.format(sale.amount)} ريال',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 15,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'الكمية: ${sale.quantity} · طريقة الدفع: ${sale.paymentType == "CASH" ? "نقد" : sale.paymentType == "ELECTRONIC" ? "إلكتروني" : "آجل"}',
                                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                                  ),
                                  Text(
                                    _timeFormat.format(sale.soldAt),
                                    style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                                  ),
                                ],
                              ),
                              const Divider(height: 16),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    sale.workerName != null ? 'البائع: ${sale.workerName}' : 'البائع: المالك',
                                    style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                                  ),
                                  TextButton.icon(
                                    icon: const Icon(Icons.assignment_return_outlined, size: 16, color: AppColors.lossRed),
                                    label: const Text('إرجاع', style: TextStyle(color: AppColors.lossRed, fontSize: 12)),
                                    onPressed: () => _showReturnDialog(sale),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
