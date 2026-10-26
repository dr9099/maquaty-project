import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/credit_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة الآجل وإدارة ديون العملاء — الشاشة 11 (CREDIT / 11-credit.jpg)
class CreditScreen extends StatefulWidget {
  const CreditScreen({super.key});

  @override
  State<CreditScreen> createState() => _CreditScreenState();
}

class _CreditScreenState extends State<CreditScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CreditProvider>().fetchCustomers();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showAddCustomerDialog() {
    final nameController = TextEditingController();
    final phoneController = TextEditingController();
    final limitController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('إضافة عميل آجل جديد', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'اسم العميل الكامل'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: phoneController,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'رقم الهاتف (اختياري)'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: limitController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'سقف الائتمان بالريال (اختياري)'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: () async {
                final name = nameController.text.trim();
                final phone = phoneController.text.trim();
                final limit = double.tryParse(limitController.text);

                if (name.isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('اسم العميل مطلوب')),
                  );
                  return;
                }

                Navigator.pop(ctx);
                final credit = context.read<CreditProvider>();
                final success = await credit.addCustomer(
                  name: name,
                  phone: phone.isNotEmpty ? phone : null,
                  creditLimit: limit,
                );

                if (success && mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('تمت إضافة العميل بنجاح ✅')),
                  );
                }
              },
              child: const Text('إضافة العميل'),
            ),
          ],
        ),
      ),
    );
  }

  void _showRecordPaymentDialog(CreditCustomer customer) {
    final amountController = TextEditingController();
    final notesController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: Text('سداد دفعة للعميل: ${customer.name}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('إجمالي الدين الحالي: ${_currencyFormat.format(customer.totalDebt)} ريال', style: const TextStyle(color: AppColors.lossRed, fontWeight: FontWeight.bold)),
              const SizedBox(height: 14),
              TextField(
                controller: amountController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'المبلغ المدفوع (ريال)'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: notesController,
                decoration: const InputDecoration(labelText: 'ملاحظات السداد (اختياري)'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.cashGreen),
              onPressed: () async {
                final amount = double.tryParse(amountController.text) ?? 0.0;
                if (amount <= 0) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('المبلغ يجب أن يكون أكبر من صفر')),
                  );
                  return;
                }

                Navigator.pop(ctx);
                final credit = context.read<CreditProvider>();
                final success = await credit.recordPayment(
                  customerId: customer.id,
                  amount: amount,
                  notes: notesController.text.trim(),
                );

                if (success && mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('تم تسجيل دفعة السداد بنجاح ✅')),
                  );
                }
              },
              child: const Text('تأكيد السداد'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final credit = context.watch<CreditProvider>();
    final customers = credit.customers;

    double totalAllDebts = 0.0;
    for (var c in customers) {
      totalAllDebts += c.totalDebt;
    }

    return AppScaffold(
      title: 'إدارة الآجل والديون',
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        onPressed: _showAddCustomerDialog,
        child: const Icon(Icons.person_add),
      ),
      body: Column(
        children: [
          // بطاقة إجمالي الديون في السوق
          Container(
            margin: const EdgeInsets.all(14),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.primaryDark,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('إجمالي الديون القائمة (الذمم)', style: TextStyle(color: AppColors.surfaceMuted, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(
                      '${_currencyFormat.format(totalAllDebts)} ريال',
                      style: const TextStyle(color: AppColors.secondary, fontSize: 20, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                Text(
                  '${customers.length} عميل',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),

          // قائمة عملاء الآجل
          Expanded(
            child: credit.isLoading
                ? const Center(child: CircularProgressIndicator())
                : customers.isEmpty
                    ? const Center(
                        child: Text('لا يوجد عملاء آجل مسجلين بعد', style: TextStyle(color: AppColors.textSecondary)),
                      )
                    : RefreshIndicator(
                        onRefresh: () => context.read<CreditProvider>().fetchCustomers(),
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          itemCount: customers.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final c = customers[index];
                            final hasLimit = c.creditLimit != null;

                            return Card(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Row(
                                          children: [
                                            CircleAvatar(
                                              backgroundColor: AppColors.secondary.withOpacity(0.2),
                                              child: const Icon(Icons.person, color: AppColors.primary),
                                            ),
                                            const SizedBox(width: 10),
                                            Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(c.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                                                if (c.phone != null)
                                                  Text(c.phone!, style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                                              ],
                                            ),
                                          ],
                                        ),
                                        Column(
                                          crossAxisAlignment: CrossAxisAlignment.end,
                                          children: [
                                            Text(
                                              '${_currencyFormat.format(c.totalDebt)} ريال',
                                              style: TextStyle(
                                                fontWeight: FontWeight.bold,
                                                fontSize: 15,
                                                color: c.totalDebt > 0 ? AppColors.lossRed : AppColors.cashGreen,
                                              ),
                                            ),
                                            if (hasLimit)
                                              Text(
                                                'السقف: ${_currencyFormat.format(c.creditLimit)} ريال',
                                                style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    const Divider(height: 16),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.end,
                                      children: [
                                        OutlinedButton.icon(
                                          icon: const Icon(Icons.add_card, size: 16),
                                          label: const Text('سداد دفعة', style: TextStyle(fontSize: 12)),
                                          onPressed: () => _showRecordPaymentDialog(c),
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
        ],
      ),
    );
  }
}
