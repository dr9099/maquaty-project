import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/quantity_formatter.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة معالجة العمليات المرفوضة — الشاشة 28 (REJECTED_TRANSACTIONS / 28-rejected-transactions.jpg)
class RejectedTransactionsScreen extends StatefulWidget {
  const RejectedTransactionsScreen({super.key});

  @override
  State<RejectedTransactionsScreen> createState() => _RejectedTransactionsScreenState();
}

class _RejectedTransactionsScreenState extends State<RejectedTransactionsScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  bool _isLoading = true;
  List<dynamic> _transactions = [];

  @override
  void initState() {
    super.initState();
    _fetchRejected();
  }

  Future<void> _fetchRejected() async {
    setState(() => _isLoading = true);
    try {
      final api = ApiClient();
      final res = await api.get('${ApiEndpoints.rejectedTransactions}?status=PENDING');
      setState(() {
        _transactions = res.data ?? [];
        _isLoading = false;
      });
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _resolve(String id, String action, {double? adjustedQty}) async {
    try {
      final api = ApiClient();
      await api.post(
        ApiEndpoints.resolveRejectedTransaction(id),
        data: {
          'resolutionAction': action,
          if (adjustedQty != null) 'adjustedQuantity': adjustedQty,
        },
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تمت معالجة العملية المرفوضة بنجاح ✅')),
        );
      }
      _fetchRejected();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    }
  }

  void _showAdjustQtyDialog(String id) {
    final qtyController = TextEditingController(text: '1');
    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('الموافقة بالكمية المصححة المتوفرة'),
          content: TextField(
            controller: qtyController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'الكمية المتوفرة للاعتماد'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
            ElevatedButton(
              onPressed: () {
                final qty = double.tryParse(qtyController.text) ?? 1.0;
                Navigator.pop(ctx);
                _resolve(id, 'APPROVE_ADJUSTED_QTY', adjustedQty: qty);
              },
              child: const Text('تأكيد الاعتماد'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'العمليات المرفوضة (R-30)',
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _transactions.isEmpty
              ? const Center(
                  child: Text(
                    'لا توجد عمليات مرفوضة معلقة بحاجة لمعالجة ✅',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _fetchRejected,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(14),
                    itemCount: _transactions.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final item = _transactions[index];
                      final id = item['id'];
                      final reasonCode = item['rejection_reason_code'];
                      final reasonDetail = item['rejection_reason_detail'] ?? '';
                      final payload = item['attempted_payload'] ?? {};
                      final double amount = (payload['amount'] as num?)?.toDouble() ?? 0.0;
                      final double quantity = (payload['quantity'] as num?)?.toDouble() ?? 0.0;
                      final String? rawUnit = payload['unit']?.toString();
                      final String displayQty = formatQuantityDisplay(quantity, unit: rawUnit);

                      final isCreditLimit = reasonCode == 'CREDIT_LIMIT_EXCEEDED';
                      final isStock = reasonCode == 'INSUFFICIENT_STOCK';

                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    children: [
                                      const Icon(Icons.warning_amber_rounded, color: AppColors.lossRed, size: 22),
                                      const SizedBox(width: 8),
                                      Text(
                                        isCreditLimit ? 'تجاوز سقف الائتمان' : isStock ? 'نقص في المخزون' : 'تعارض مزامنة',
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppColors.lossRed),
                                      ),
                                    ],
                                  ),
                                  Text(
                                    '${_currencyFormat.format(amount)} ريال',
                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.primary),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text(reasonDetail, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                              Text('الكمية المحاولة: $displayQty', style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                              const Divider(height: 18),

                              // خيارات المعالجة المعتمدة حسب سبب الرفض (R-30)
                              if (isCreditLimit)
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton(
                                        onPressed: () => _resolve(id, 'ADD_CREDIT'),
                                        child: const Text('اعتماد كدين', style: TextStyle(fontSize: 12)),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: ElevatedButton(
                                        style: ElevatedButton.styleFrom(backgroundColor: AppColors.lossRed),
                                        onPressed: () => _resolve(id, 'POST_AS_LOSS'),
                                        child: const Text('ترحيل كخسارة', style: TextStyle(fontSize: 12)),
                                      ),
                                    ),
                                  ],
                                ),

                              if (isStock)
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton(
                                        onPressed: () => _showAdjustQtyDialog(id),
                                        child: const Text('كمية مصححة', style: TextStyle(fontSize: 11)),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Expanded(
                                      child: OutlinedButton(
                                        onPressed: () => _resolve(id, 'APPROVE_NEGATIVE_STOCK'),
                                        child: const Text('بيع بالسالب', style: TextStyle(fontSize: 11)),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Expanded(
                                      child: ElevatedButton(
                                        style: ElevatedButton.styleFrom(backgroundColor: AppColors.textMuted),
                                        onPressed: () => _resolve(id, 'FINAL_REJECT'),
                                        child: const Text('رفض نهائي', style: TextStyle(fontSize: 11)),
                                      ),
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
