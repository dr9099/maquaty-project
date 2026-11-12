import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/utils/quantity_formatter.dart';
import '../../providers/sales_provider.dart';
import '../../providers/store_settings_provider.dart';
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
    final symbol = context.read<StoreSettingsProvider>().currencySymbol;
    final isKilo = isKiloUnit(sale.unit);
    String returnUnit = 'KILO';
    final qtyController = TextEditingController(
      text: sale.quantity == sale.quantity.truncateToDouble()
          ? sale.quantity.toStringAsFixed(0)
          : sale.quantity.toString(),
    );
    final reasonController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          return Directionality(
            textDirection: TextDirection.rtl,
            child: AlertDialog(
              title: const Text('تسجيل مرتجع مبيعات', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('الصنف: ${sale.itemName}', style: const TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 6),
                  Text('المبلغ الأصلي: ${_currencyFormat.format(sale.amount)} $symbol'),
                  Text('الكمية المباعة: ${sale.displayQuantity}', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  if (isKilo) ...[
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        const Text('وحدة الإرجاع: ', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.primary)),
                        const SizedBox(width: 8),
                        ChoiceChip(
                          label: const Text('كيلو', style: TextStyle(fontSize: 11)),
                          selected: returnUnit == 'KILO',
                          onSelected: (sel) {
                            if (sel) {
                              setDialogState(() {
                                returnUnit = 'KILO';
                                final q = double.tryParse(qtyController.text) ?? 1000.0;
                                qtyController.text = (q / 1000.0).toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
                              });
                            }
                          },
                        ),
                        const SizedBox(width: 6),
                        ChoiceChip(
                          label: const Text('جرام', style: TextStyle(fontSize: 11)),
                          selected: returnUnit == 'GRAM',
                          onSelected: (sel) {
                            if (sel) {
                              setDialogState(() {
                                returnUnit = 'GRAM';
                                final q = double.tryParse(qtyController.text) ?? 1.0;
                                qtyController.text = (q * 1000).toInt().toString();
                              });
                            }
                          },
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 10),
                  TextField(
                    controller: qtyController,
                    onChanged: (_) => setDialogState(() {}),
                    keyboardType: returnUnit == 'GRAM'
                        ? TextInputType.number
                        : const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(
                      labelText: returnUnit == 'GRAM' ? 'الكمية المرتجعة بالجرام (جم)' : 'الكمية المرتجعة (${sale.unit})',
                      helperText: isKilo && qtyController.text.isNotEmpty
                          ? '= ${formatQuantityDisplay(returnUnit == "GRAM" ? (double.tryParse(qtyController.text) ?? 0.0) * 0.001 : (double.tryParse(qtyController.text) ?? 0.0), unit: "كيلو")}'
                          : null,
                    ),
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

                    if (returnUnit == 'GRAM' && qty != qty.truncateToDouble()) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          backgroundColor: AppColors.lossRed,
                          content: Text('الكمية بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.'),
                        ),
                      );
                      return;
                    }

                    Navigator.pop(ctx);
                    final sales = context.read<SalesProvider>();
                    final success = await sales.processReturn(
                      saleId: sale.id,
                      quantity: qty,
                      quantityUnit: isKilo && returnUnit == 'GRAM' ? 'GRAM' : 'KILO',
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
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final salesProvider = context.watch<SalesProvider>();
    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;
    final sales = salesProvider.todaySales;

    return AppScaffold(
      title: 'سجل العمليات اليومية',
      currentBottomNavIndex: 3,
      body: salesProvider.isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Expanded(
                  child: sales.isEmpty
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
                      final isCreditPayment = sale.isCreditPayment;

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
                                      if (isCreditPayment) ...[
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: AppColors.primary.withOpacity(0.12),
                                            borderRadius: BorderRadius.circular(6),
                                          ),
                                          child: const Text(
                                            'سداد ذمة',
                                            style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppColors.primary),
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                      ],
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
                                    '${_currencyFormat.format(sale.amount)} $symbol',
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
                                    isCreditPayment
                                        ? 'سداد دين عميل · طريقة الدفع: ${sale.paymentType == "CASH" ? "نقد" : sale.paymentType == "ELECTRONIC" ? "إلكتروني" : "آجل"}'
                                        : 'الكمية: ${sale.displayQuantity} · طريقة الدفع: ${sale.paymentType == "CASH" ? "نقد" : sale.paymentType == "ELECTRONIC" ? "إلكتروني" : "آجل"}',
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
                                  if (sale.type == 'SALE')
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
                ),
                if (salesProvider.totals != null)
                  Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.06),
                    offset: const Offset(0, -2),
                    blurRadius: 8,
                  ),
                ],
              ),
              child: SafeArea(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _summaryChip('نقد اليوم', salesProvider.totals!.cash, AppColors.cashGreen, symbol),
                    _summaryChip('إلكتروني', salesProvider.totals!.electronic, AppColors.primary, symbol),
                    _summaryChip('مصروفات وسلف', salesProvider.totals!.expenses, AppColors.lossRed, symbol),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _summaryChip(String label, double amount, Color color, String symbol) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 2),
        Text(
          '${_currencyFormat.format(amount)} $symbol',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
      ],
    );
  }
}
