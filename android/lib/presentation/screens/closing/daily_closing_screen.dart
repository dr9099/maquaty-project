import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/daily_closing_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة المطابقة اليومية والإغلاق — صندوق كل يوم يبدأ من 0 ريال دون ترحيل من أمس
class DailyClosingScreen extends StatefulWidget {
  const DailyClosingScreen({super.key});

  @override
  State<DailyClosingScreen> createState() => _DailyClosingScreenState();
}

class _DailyClosingScreenState extends State<DailyClosingScreen> {
  final _currencyFormat = NumberFormat('#,##0.##', 'ar');
  String? _selectedWorkerId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DailyClosingProvider>().fetchTodayClosing();
    });
  }

  void _showActualCashDialog(
    double? currentActual,
    String symbol, {
    String? targetWorkerId,
  }) {
    final controller = TextEditingController(
      text: currentActual != null ? currentActual.toStringAsFixed(0) : '',
    );

    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text(
            'إدخال الكاش الفعلي في صندوق اليوم',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
          ),
          content: TextField(
            controller: controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: 'المبلغ الفعلي الموجود بالدرج الآن ($symbol)',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: () async {
                final cash = double.tryParse(controller.text);
                if (cash == null || cash < 0) return;
                Navigator.pop(ctx);
                final prov = context.read<DailyClosingProvider>();
                final ok = await prov.updateActualCash(cash, workerId: targetWorkerId);
                if (ok && mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('تم تحديث الكاش الفعلي لصندوق اليوم ✅'),
                    ),
                  );
                } else if (mounted && prov.errorMessage != null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      backgroundColor: AppColors.lossRed,
                      content: Text(prov.errorMessage!),
                    ),
                  );
                }
              },
              child: const Text('حفظ المطابقة'),
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
    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;
    final data = closingProv.closing;
    final isOwner = auth.isOwner;
    final isClosed = data?.isClosed ?? false;
    final sum = data?.summary ?? const {};

    final effectiveWorkerId = isOwner
        ? _selectedWorkerId
        : (_selectedWorkerId ?? data?.workerId ?? auth.workerId);

    final String? dropdownValue;
    if (data != null && data.workers.isNotEmpty) {
      if (isOwner) {
        final bool exists = effectiveWorkerId == null ||
            data.workers.any((w) =>
                (w is Map ? (w['id'] ?? '') : '').toString() == effectiveWorkerId);
        dropdownValue = exists ? effectiveWorkerId : null;
      } else {
        final bool exists = effectiveWorkerId != null &&
            data.workers.any((w) =>
                (w is Map ? (w['id'] ?? '') : '').toString() == effectiveWorkerId);
        dropdownValue = exists
            ? effectiveWorkerId
            : (data.workers.first is Map
                ? (data.workers.first['id'] ?? '').toString()
                : null);
      }
    } else {
      dropdownValue = effectiveWorkerId;
    }

    return AppScaffold(
      title: 'المطابقة والإغلاق اليومي',
      body: closingProv.isLoading
          ? const Center(child: CircularProgressIndicator())
          : data == null
              ? const Center(child: Text('تعذر تحميل بيانات الإغلاق'))
              : RefreshIndicator(
                  onRefresh: () =>
                      context.read<DailyClosingProvider>().fetchTodayClosing(workerId: effectiveWorkerId),
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // محدد مطابقة العمال للمالك والعامل المسؤول (M-12)
                      if ((isOwner || auth.isResponsibleWorker) && data.workers.isNotEmpty) ...[
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.primary.withOpacity(0.25)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.person_pin_outlined, color: AppColors.primary, size: 22),
                              const SizedBox(width: 8),
                              const Text(
                                'عرض صندوق:',
                                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: DropdownButtonHideUnderline(
                                  child: DropdownButton<String?>(
                                    value: dropdownValue,
                                    isExpanded: true,
                                    items: [
                                      if (isOwner)
                                        const DropdownMenuItem<String?>(
                                          value: null,
                                          child: Text(
                                            'صندوق المتجر العام (المالك)',
                                            style: TextStyle(
                                              fontWeight: FontWeight.bold,
                                              color: AppColors.primary,
                                            ),
                                          ),
                                        ),
                                      ...data.workers.map((w) {
                                        final wMap = w is Map ? w : <String, dynamic>{};
                                        final id = (wMap['id'] ?? '').toString();
                                        final name = (wMap['name'] ?? wMap['full_name'] ?? 'عامل').toString();
                                        final isResp = wMap['is_responsible'] == true;
                                        return DropdownMenuItem<String?>(
                                          value: id,
                                          child: Text(
                                            '$name ${isResp ? "(مسؤول)" : ""}',
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                              fontWeight: isResp ? FontWeight.bold : FontWeight.normal,
                                            ),
                                          ),
                                        );
                                      }),
                                    ],
                                    onChanged: (val) {
                                      setState(() => _selectedWorkerId = val);
                                      context.read<DailyClosingProvider>().fetchTodayClosing(workerId: val);
                                    },
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // شريط قاعدة الصندوق اليومي المستقل (يبدأ من 0 دائماً)
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.secondary.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: AppColors.primary.withOpacity(0.25),
                          ),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.info_outline, color: AppColors.primary, size: 20),
                            SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'رصيد افتتاح صندوق اليوم = 0 دائماً — كل يوم جديد مستقل تماماً ولا يُرحّل إليه صندوق أمس.',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.primary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),

                      // شريط حالة الإغلاق
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        decoration: BoxDecoration(
                          color: isClosed
                              ? AppColors.cashGreen.withOpacity(0.12)
                              : AppColors.primary.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: isClosed
                                ? AppColors.cashGreen
                                : AppColors.primary.withOpacity(0.3),
                          ),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              isClosed
                                  ? 'حالة اليوم: معتمد ومغلق ✅'
                                  : 'حالة اليوم: مفتوح للعمليات',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                                color: isClosed
                                    ? AppColors.cashGreen
                                    : AppColors.primary,
                              ),
                            ),
                            Text(
                              data.closingDate,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      // بطاقات المطابقة المالية: المتوقع vs الفعلي vs الفرق
                      Row(
                        children: [
                          Expanded(
                            child: _metricCard(
                              'المتوقع بالنظام',
                              _currencyFormat.format(data.expectedCash),
                              symbol,
                              AppColors.primary,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _metricCard(
                              'الفعلي بالصندوق',
                              data.actualCash != null
                                  ? _currencyFormat.format(data.actualCash)
                                  : '0',
                              symbol,
                              AppColors.cashGreen,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _metricCard(
                              'فرق اليوم',
                              data.difference != null
                                  ? _currencyFormat.format(data.difference)
                                  : '0',
                              symbol,
                              (data.difference ?? 0) < 0
                                  ? AppColors.lossRed
                                  : AppColors.primary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      if (!isClosed)
                        OutlinedButton.icon(
                          onPressed: () => _showActualCashDialog(
                            data.actualCash,
                            symbol,
                            targetWorkerId: effectiveWorkerId,
                          ),
                          icon: const Icon(Icons.edit_outlined),
                          label: const Text('إدخال / تعديل الكاش الفعلي في الدرج'),
                        ),

                      const SizedBox(height: 18),

                      // تفصيل حركات صندوق اليوم فقط
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'تفصيل حركات صندوق اليوم (من 0)',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                  color: AppColors.primary,
                                ),
                              ),
                              const Divider(height: 16),
                              _cashLine('رصيد بداية اليوم', 0, symbol),
                              _cashLine(
                                '(+) مبيعات نقدية اليوم',
                                (sum['cash_sales'] as num?)?.toDouble() ?? 0,
                                symbol,
                                positive: true,
                              ),
                              _cashLine(
                                '(-) مرتجعات مبيعات نقدية',
                                (sum['cash_sale_returns'] as num?)?.toDouble() ?? 0,
                                symbol,
                                negative: true,
                              ),
                              _cashLine(
                                '(+) تحصيل ديون عملاء نقداً',
                                (sum['collected_cash_payments'] as num?)
                                        ?.toDouble() ??
                                    0,
                                symbol,
                                positive: true,
                              ),
                              _cashLine(
                                '(-) مشتريات وسداد موردين نقداً',
                                ((sum['cash_purchases'] as num?)?.toDouble() ?? 0) +
                                    ((sum['cash_supplier_payments'] as num?)
                                            ?.toDouble() ??
                                        0),
                                symbol,
                                negative: true,
                              ),
                              if (((sum['cash_purchase_refunds'] as num?)?.toDouble() ?? 0) > 0)
                                _cashLine(
                                  '(+) استردادات مرتجعات مشتريات نقداً',
                                  (sum['cash_purchase_refunds'] as num?)?.toDouble() ?? 0,
                                  symbol,
                                  positive: true,
                                ),
                              _cashLine(
                                '(-) مصروفات وسلف نقدية اليوم',
                                (sum['cash_expenses'] as num?)?.toDouble() ?? 0,
                                symbol,
                                negative: true,
                              ),
                              if (isOwner) ...[
                                _cashLine(
                                  '(+) إيداعات المالك النقدية + سحب المحافظ للصندوق',
                                  ((sum['owner_cash_deposits'] as num?)
                                              ?.toDouble() ??
                                          0) +
                                      ((sum['wallet_cash_outs'] as num?)
                                              ?.toDouble() ??
                                          0),
                                  symbol,
                                  positive: true,
                                ),
                                _cashLine(
                                  '(-) مسحوبات المالك النقدية',
                                  (sum['owner_cash_withdrawals'] as num?)
                                          ?.toDouble() ??
                                      0,
                                  symbol,
                                  negative: true,
                                ),
                              ],
                              const Divider(height: 16),
                              _cashLine(
                                '(=) الكاش المتوقع في صندوق اليوم',
                                data.expectedCash,
                                symbol,
                                bold: true,
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),

                      // زر اعتماد الإغلاق اليومي (حصري للمالك)
                      if (isOwner && !isClosed)
                        ElevatedButton.icon(
                          icon: const Icon(Icons.check_circle_outline),
                          label: const Text(
                            'اعتماد الإغلاق اليومي وترحيل فرق الصندوق',
                            style: TextStyle(fontSize: 15),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.primary,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                          onPressed: () async {
                            final messenger = ScaffoldMessenger.of(context);
                            final ok = await closingProv.approveClosing();
                            if (ok && mounted) {
                              messenger.showSnackBar(
                                const SnackBar(
                                  content: Text('تم اعتماد الإغلاق اليومي بنجاح 🔒'),
                                ),
                              );
                            } else if (mounted &&
                                closingProv.errorMessage != null) {
                              messenger.showSnackBar(
                                SnackBar(
                                  backgroundColor: AppColors.lossRed,
                                  content: Text(closingProv.errorMessage!),
                                ),
                              );
                            }
                          },
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _cashLine(
    String label,
    double val,
    String symbol, {
    bool positive = false,
    bool negative = false,
    bool bold = false,
  }) {
    Color color = AppColors.textPrimary;
    if (positive && val > 0) color = AppColors.cashGreen;
    if (negative && val > 0) color = AppColors.lossRed;
    if (bold) color = AppColors.primary;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: bold ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
          Text(
            '${_currencyFormat.format(val)} $symbol',
            style: TextStyle(
              fontSize: bold ? 14 : 12,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _metricCard(String label, String value, String symbol, Color color) {
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
          Text(
            label,
            style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          Text(
            symbol,
            style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}
