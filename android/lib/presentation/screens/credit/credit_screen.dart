import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../providers/credit_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة الآجل وإدارة ديون العملاء وكشف الحساب مع المرتجعات والسداد الإلكتروني — الشاشة 11 (CREDIT)
class CreditScreen extends StatefulWidget {
  const CreditScreen({super.key});

  @override
  State<CreditScreen> createState() => _CreditScreenState();
}

class _CreditScreenState extends State<CreditScreen> {
  final _currencyFormat = NumberFormat('#,##0.##', 'ar');
  final _searchController = TextEditingController();
  List<Map<String, dynamic>> _wallets = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      context.read<CreditProvider>().fetchCustomers();
      try {
        final res = await ApiClient().get(ApiEndpoints.wallets);
        if (res.data is List && mounted) {
          setState(() {
            _wallets = (res.data as List)
                .map((e) => Map<String, dynamic>.from(e))
                .where((w) => w['is_active'] != false)
                .toList();
          });
        }
      } catch (_) {}
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
    final symbol = context.read<StoreSettingsProvider>().currencySymbol;

    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text(
            'إضافة عميل آجل جديد',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
          ),
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
                decoration: InputDecoration(labelText: 'سقف الائتمان ($symbol - اختياري)'),
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
    final symbol = context.read<StoreSettingsProvider>().currencySymbol;
    String paymentMethod = 'CASH';
    String? selectedWalletId =
        _wallets.isNotEmpty ? _wallets.first['id']?.toString() : null;
    String? attachmentUrl;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: Text(
              'سداد دفعة للعميل: ${customer.name}',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'إجمالي الدين الحالي: ${_currencyFormat.format(customer.totalDebt)} $symbol',
                    style: const TextStyle(
                      color: AppColors.lossRed,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: amountController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(labelText: 'المبلغ المدفوع ($symbol) *'),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: paymentMethod,
                    decoration: const InputDecoration(labelText: 'طريقة السداد *'),
                    items: const [
                      DropdownMenuItem(
                        value: 'CASH',
                        child: Text('نقداً (إلى صندوق المحل)'),
                      ),
                      DropdownMenuItem(
                        value: 'ELECTRONIC',
                        child: Text('محفظة إلكترونية'),
                      ),
                    ],
                    onChanged: (val) {
                      if (val != null) {
                        setDialogState(() => paymentMethod = val);
                      }
                    },
                  ),
                  if (paymentMethod == 'ELECTRONIC') ...[
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      value: selectedWalletId,
                      decoration: const InputDecoration(
                        labelText: 'اختيار المحفظة الإلكترونية *',
                      ),
                      items: _wallets
                          .map(
                            (w) => DropdownMenuItem<String>(
                              value: w['id']?.toString(),
                              child: Text(w['name']?.toString() ?? 'محفظة'),
                            ),
                          )
                          .toList(),
                      onChanged: (val) => setDialogState(() => selectedWalletId = val),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      icon: Icon(
                        attachmentUrl != null
                            ? Icons.check_circle
                            : Icons.camera_alt_outlined,
                        color: attachmentUrl != null
                            ? AppColors.cashGreen
                            : AppColors.primary,
                      ),
                      label: Text(
                        attachmentUrl != null
                            ? 'تم إرفاق صورة إشعار السداد ✅'
                            : 'إرفاق صورة إشعار الإيداع (إلزامي) *',
                        style: const TextStyle(fontSize: 12),
                      ),
                      onPressed: () async {
                        try {
                          final picked = await ImagePicker().pickImage(
                            source: ImageSource.gallery,
                            imageQuality: 75,
                          );
                          if (picked != null) {
                            setDialogState(() => attachmentUrl = picked.path);
                          }
                        } catch (_) {
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                backgroundColor: AppColors.lossRed,
                                content: Text(
                                  'تعذر اختيار صورة إشعار السداد. يرجى التحقق من صلاحيات الصور.',
                                ),
                              ),
                            );
                          }
                        }
                      },
                    ),
                  ],
                  const SizedBox(height: 10),
                  TextField(
                    controller: notesController,
                    decoration: const InputDecoration(labelText: 'ملاحظات السداد (اختياري)'),
                  ),
                ],
              ),
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
                  if (paymentMethod == 'ELECTRONIC') {
                    if (selectedWalletId == null || selectedWalletId!.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          backgroundColor: AppColors.lossRed,
                          content: Text('يرجى اختيار المحفظة الإلكترونية أولاً'),
                        ),
                      );
                      return;
                    }
                    if (attachmentUrl == null || attachmentUrl!.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          backgroundColor: AppColors.lossRed,
                          content: Text(
                            'صورة إشعار الإيداع إلزامية عند السداد عبر محفظة إلكترونية',
                          ),
                        ),
                      );
                      return;
                    }
                  }

                  final credit = context.read<CreditProvider>();
                  final auth = context.read<AuthProvider>();
                  final success = await credit.collectDebt(
                    customerId: customer.id,
                    amount: amount,
                    paymentMethod: paymentMethod,
                    walletId: paymentMethod == 'ELECTRONIC' ? selectedWalletId : null,
                    attachmentUrl: paymentMethod == 'ELECTRONIC' ? attachmentUrl : null,
                    notes: notesController.text.trim(),
                    storeOwnerId: auth.storeOwnerId,
                  );

                  if (!mounted) return;
                  if (success) {
                    if (ctx.mounted) Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          credit.lastOperationQueuedOffline
                              ? 'تم حفظ دفعة السداد محلياً وستتم مزامنتها تلقائياً ✅'
                              : 'تم تسجيل دفعة السداد بنجاح ✅',
                        ),
                      ),
                    );
                  } else if (credit.errorMessage != null) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        backgroundColor: AppColors.lossRed,
                        content: Text(credit.errorMessage!),
                      ),
                    );
                  }
                },
                child: const Text('تأكيد السداد'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showStatementSheet(CreditCustomer customer) async {
    final symbol = context.read<StoreSettingsProvider>().currencySymbol;
    final statement = await context.read<CreditProvider>().fetchStatement(customer.id);
    if (!mounted) return;

    final txList = (statement?['transactions'] is List)
        ? (statement!['transactions'] as List)
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
        : <Map<String, dynamic>>[];
    final balance =
        ((statement?['customer']?['total_debt'] ?? customer.totalDebt) as num)
            .toDouble();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.7,
          maxChildSize: 0.92,
          builder: (_, scrollCtrl) => Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        'كشف حساب العميل: ${customer.name}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                    Text(
                      'الرصيد: ${_currencyFormat.format(balance)} $symbol',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                        color: balance > 0 ? AppColors.lossRed : AppColors.cashGreen,
                      ),
                    ),
                  ],
                ),
                const Divider(height: 20),
                Expanded(
                  child: txList.isEmpty
                      ? const Center(child: Text('لا توجد حركات مسجلة لهذا العميل.'))
                      : ListView.separated(
                          controller: scrollCtrl,
                          itemCount: txList.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 6),
                          itemBuilder: (_, idx) {
                            final tx = txList[idx];
                            final type = (tx['type'] ?? '').toString();
                            final amt = (tx['amount'] as num?)?.toDouble() ?? 0.0;
                            final isSale = type == 'SALE';
                            final isReturn = type == 'RETURN';
                            final label = isSale
                                ? 'بيع آجل (+)'
                                : isReturn
                                    ? 'مرتجع مبيعات آجلة (-)'
                                    : 'دفعة سداد (-)';
                            final rawMethod = tx['payment_method']?.toString();
                            final methodAr = rawMethod == 'CASH'
                                ? 'نقداً'
                                : rawMethod == 'ELECTRONIC'
                                    ? 'إلكترونياً'
                                    : rawMethod == 'CREDIT'
                                        ? 'آجل'
                                        : (rawMethod ?? '');
                            final desc = (tx['item_name'] ??
                                    tx['reason'] ??
                                    tx['note'] ??
                                    methodAr)
                                .toString();
                            final dateStr = (tx['date'] ?? '').toString();

                            return Card(
                              child: ListTile(
                                dense: true,
                                leading: Icon(
                                  isSale
                                      ? Icons.shopping_cart_outlined
                                      : isReturn
                                          ? Icons.assignment_return_outlined
                                          : Icons.payments_outlined,
                                  color: isSale
                                      ? AppColors.creditOrange
                                      : AppColors.cashGreen,
                                ),
                                title: Text(
                                  label,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                                subtitle: Text(
                                  [
                                    if (desc.isNotEmpty) desc,
                                    if (dateStr.length >= 10) dateStr.substring(0, 10),
                                  ].join(' · '),
                                  style: const TextStyle(fontSize: 11),
                                ),
                                trailing: Text(
                                  '${isSale ? "+" : "-"}${_currencyFormat.format(amt)} $symbol',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: isSale
                                        ? AppColors.lossRed
                                        : AppColors.cashGreen,
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final credit = context.watch<CreditProvider>();
    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;
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
                    const Text(
                      'إجمالي الديون القائمة (حساب 1200)',
                      style: TextStyle(color: AppColors.surfaceMuted, fontSize: 12),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${_currencyFormat.format(totalAllDebts)} $symbol',
                      style: const TextStyle(
                        color: AppColors.secondary,
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                Text(
                  '${customers.length} عميل',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
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
                        child: Text(
                          'لا يوجد عملاء آجل مسجلين بعد',
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: () =>
                            context.read<CreditProvider>().fetchCustomers(),
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 8,
                          ),
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
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        Row(
                                          children: [
                                            CircleAvatar(
                                              backgroundColor: AppColors.secondary
                                                  .withOpacity(0.2),
                                              child: const Icon(
                                                Icons.person,
                                                color: AppColors.primary,
                                              ),
                                            ),
                                            const SizedBox(width: 10),
                                            Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  c.name,
                                                  style: const TextStyle(
                                                    fontWeight: FontWeight.bold,
                                                    fontSize: 14,
                                                  ),
                                                ),
                                                if (c.phone != null)
                                                  Text(
                                                    c.phone!,
                                                    style: const TextStyle(
                                                      fontSize: 11,
                                                      color: AppColors.textMuted,
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ],
                                        ),
                                        Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.end,
                                          children: [
                                            Text(
                                              '${_currencyFormat.format(c.totalDebt)} $symbol',
                                              style: TextStyle(
                                                fontWeight: FontWeight.bold,
                                                fontSize: 15,
                                                color: c.totalDebt > 0
                                                    ? AppColors.lossRed
                                                    : AppColors.cashGreen,
                                              ),
                                            ),
                                            if (hasLimit)
                                              Text(
                                                'السقف: ${_currencyFormat.format(c.creditLimit)} $symbol',
                                                style: const TextStyle(
                                                  fontSize: 10,
                                                  color: AppColors.textMuted,
                                                ),
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    const Divider(height: 16),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.end,
                                      children: [
                                        TextButton.icon(
                                          icon: const Icon(
                                            Icons.receipt_long_outlined,
                                            size: 16,
                                          ),
                                          label: const Text(
                                            'كشف الحساب',
                                            style: TextStyle(fontSize: 12),
                                          ),
                                          onPressed: () => _showStatementSheet(c),
                                        ),
                                        const SizedBox(width: 8),
                                        OutlinedButton.icon(
                                          icon: const Icon(
                                            Icons.add_card,
                                            size: 16,
                                          ),
                                          label: const Text(
                                            'سداد دفعة',
                                            style: TextStyle(fontSize: 12),
                                          ),
                                          onPressed: () =>
                                              _showRecordPaymentDialog(c),
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
