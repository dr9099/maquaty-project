import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/utils/quantity_formatter.dart';
import '../../providers/auth_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../providers/purchases_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';
import 'create_purchase_screen.dart';

/// شاشة تفاصيل فاتورة الشراء، اعتماد المسودة، إلغاء الفاتورة، وتسجيل مرتجع مشتريات
class PurchaseDetailScreen extends StatefulWidget {
  final String invoiceId;

  const PurchaseDetailScreen({super.key, required this.invoiceId});

  @override
  State<PurchaseDetailScreen> createState() => _PurchaseDetailScreenState();
}

class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
  final _numFormat = NumberFormat('#,##0.##', 'ar');
  bool _loading = true;
  PurchaseInvoiceModel? _invoice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final storeOwnerId = context.read<AuthProvider>().storeOwnerId;
    final inv = await context.read<PurchasesProvider>().fetchPurchaseById(
          widget.invoiceId,
          storeOwnerId: storeOwnerId,
        );
    if (!mounted) return;
    setState(() {
      _invoice = inv;
      _loading = false;
    });
  }

  Future<void> _handlePostDraft(PurchaseInvoiceModel inv) async {
    final prov = context.read<PurchasesProvider>();
    final settings = context.read<StoreSettingsProvider>();

    final previewInputs = inv.items
        .map(
          (i) => PurchaseLineInput(
            itemId: i.itemId,
            itemName: i.itemName,
            unit: i.unit,
            baseUnit: i.baseUnit,
            conversionFactor: i.conversionFactor,
            quantity: i.quantity,
            unitCostPrice: i.unitCostPrice,
            taxAmount: i.taxAmount,
            discountAmount: i.discountAmount,
            sellPrice: i.sellPrice,
          ),
        )
        .toList();

    String? chosenMethod = settings.defaultCostingMethod;
    final preview = await prov.previewCosting(
      taxAmount: inv.taxAmount,
      discountAmount: inv.discountAmount,
      items: previewInputs,
    );
    if (!mounted) return;
    if (preview != null && preview.hasSameDayPriceConflict) {
      chosenMethod = await showSameDayCostingDialog(
        context: context,
        conflicts: preview.conflicts,
        options: preview.costingOptions,
        initialMethod: preview.defaultCostingMethod,
        currencySymbol: preview.currencySymbol,
      );
      if (chosenMethod == null || !mounted) return;
    }

    final posted = await prov.postDraft(inv.id, costingMethod: chosenMethod);
    if (!mounted) return;
    if (posted != null) {
      await context.read<InventoryProvider>().fetchInventory();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم اعتماد المسودة وتوريد المخزون بنجاح ✅')),
      );
      _load();
    } else if (prov.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(backgroundColor: AppColors.lossRed, content: Text(prov.errorMessage!)),
      );
    }
  }

  Future<void> _handleVoid(PurchaseInvoiceModel inv) async {
    final reasonCtrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('إلغاء فاتورة الشراء (Void)'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'سيتم عكس القيد المحاسبي وخصم الكمية من المخزون وتعديل ذمة المورد بشرط عدم حدوث مبيعات أو دفعات عليها.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: reasonCtrl,
                decoration: const InputDecoration(labelText: 'سبب الإلغاء *'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('تراجع')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.lossRed),
              onPressed: () {
                if (reasonCtrl.text.trim().length < 3) return;
                Navigator.pop(ctx, reasonCtrl.text.trim());
              },
              child: const Text('تأكيد الإلغاء'),
            ),
          ],
        ),
      ),
    );
    if (reason == null || !mounted) return;
    final prov = context.read<PurchasesProvider>();
    final ok = await prov.voidInvoice(inv.id, reason: reason);
    if (!mounted) return;
    if (ok) {
      await context.read<InventoryProvider>().fetchInventory();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إلغاء الفاتورة وعكس قيودها بنجاح ✅')),
      );
      _load();
    } else if (prov.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(backgroundColor: AppColors.lossRed, content: Text(prov.errorMessage!)),
      );
    }
  }

  String _formatDecimalQty(double value) {
    return value.toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
  }

  void _showReturnModal(PurchaseInvoiceModel inv, PurchaseItemModel line) {
    final qtyCtrl = TextEditingController(
      text: _formatDecimalQty(line.remainingReturnableQty),
    );
    final reasonCtrl = TextEditingController();
    String refundMethod = inv.remainingAmount > 0 ? 'DEBT_REDUCTION' : 'CASH_REFUND';
    final isKilo = isKiloUnit(line.unit) || isKiloUnit(line.baseUnit);
    String returnUnit = 'KILO';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return Directionality(
              textDirection: TextDirection.rtl,
              child: Padding(
                padding: EdgeInsets.only(
                  left: 16,
                  right: 16,
                  top: 20,
                  bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'تسجيل مرتجع للمورد: ${line.itemName}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'ملاحظة: يُسمح بمرتجع المشتريات قبل إغلاق اليوم وفقط إذا لم تتم أي عملية بيع من هذا الصنف.',
                      style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
                    ),
                    if (isKilo) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          const Text(
                            'وحدة الإرجاع: ',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.primary),
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: const Text('كيلو', style: TextStyle(fontSize: 11)),
                            selected: returnUnit == 'KILO',
                            onSelected: (sel) {
                              if (sel) {
                                setModalState(() {
                                  returnUnit = 'KILO';
                                  final q = double.tryParse(qtyCtrl.text) ?? 1000.0;
                                  qtyCtrl.text = (q / 1000.0).toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
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
                                setModalState(() {
                                  returnUnit = 'GRAM';
                                  final q = double.tryParse(qtyCtrl.text) ?? 1.0;
                                  qtyCtrl.text = (q * 1000).toInt().toString();
                                });
                              }
                            },
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: qtyCtrl,
                      onChanged: (_) => setModalState(() {}),
                      keyboardType: returnUnit == 'GRAM'
                          ? TextInputType.number
                          : const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText: returnUnit == 'GRAM'
                            ? 'الكمية المرتجعة بالجرام (جم)'
                            : 'الكمية المرتجعة بـ (${line.unit}) — المتاح: ${_formatDecimalQty(line.remainingReturnableQty)}',
                        helperText: isKilo && qtyCtrl.text.isNotEmpty
                            ? '= ${formatQuantityDisplay(returnUnit == "GRAM" ? (double.tryParse(qtyCtrl.text) ?? 0.0) * 0.001 : (double.tryParse(qtyCtrl.text) ?? 0.0), unit: "كيلو")}'
                            : null,
                      ),
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      value: refundMethod,
                      decoration: const InputDecoration(labelText: 'طريقة معالجة قيمة المرتجع'),
                      items: const [
                        DropdownMenuItem(
                          value: 'DEBT_REDUCTION',
                          child: Text('خصم من رصيد المورد المستحق'),
                        ),
                        DropdownMenuItem(
                          value: 'CASH_REFUND',
                          child: Text('استرداد نقدي إلى الصندوق'),
                        ),
                      ],
                      onChanged: (v) {
                        if (v != null) setModalState(() => refundMethod = v);
                      },
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: reasonCtrl,
                      decoration: const InputDecoration(
                        labelText: 'سبب الإرجاع للمورد * (مثال: جودة غير مطابقة)',
                      ),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () async {
                        final qty = double.tryParse(qtyCtrl.text) ?? 0.0;
                        if (qty <= 0 || reasonCtrl.text.trim().length < 2) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('يرجى إدخال كمية صحيحة وسبب الإرجاع.'),
                            ),
                          );
                          return;
                        }
                        if (returnUnit == 'GRAM' && qty != qty.truncateToDouble()) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              backgroundColor: AppColors.lossRed,
                              content: Text('الكمية المرتجعة بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.'),
                            ),
                          );
                          return;
                        }
                        final prov = context.read<PurchasesProvider>();
                        final invProv = context.read<InventoryProvider>();
                        final ok = await prov.createReturn(
                          invoiceId: inv.id,
                          purchaseItemId: line.id,
                          quantity: qty,
                          quantityUnit: isKilo && returnUnit == 'GRAM' ? 'GRAM' : 'KILO',
                          refundMethod: refundMethod,
                          reason: reasonCtrl.text,
                          storeOwnerId: context.read<AuthProvider>().storeOwnerId,
                        );
                        if (!mounted) return;
                        if (ok) {
                          if (ctx.mounted) Navigator.pop(ctx);
                          await invProv.fetchInventory(
                            storeOwnerId: context.read<AuthProvider>().storeOwnerId,
                          );
                          if (!mounted) return;
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('تم تسجيل مرتجع المشتريات بنجاح ✅')),
                          );
                          _load();
                        } else if (prov.errorMessage != null) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              backgroundColor: AppColors.lossRed,
                              content: Text(prov.errorMessage!),
                            ),
                          );
                        }
                      },
                      child: const Text('تأكيد المرتجع'),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final inv = _invoice;
    final symbol = inv?.currencySymbol ??
        context.watch<StoreSettingsProvider>().currencySymbol;

    return AppScaffold(
      title: inv != null ? 'فاتورة ${inv.invoiceNumber}' : 'تفاصيل الفاتورة',
      actions: [
        if (inv != null && inv.isPosted && auth.isOwner)
          IconButton(
            tooltip: 'إلغاء الفاتورة',
            icon: const Icon(Icons.cancel_outlined, color: Colors.orangeAccent),
            onPressed: () => _handleVoid(inv),
          ),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : inv == null
              ? const Center(child: Text('تعذر تحميل بيانات الفاتورة.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(14),
                    children: [
                      // ترويسة الفاتورة
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppColors.primary,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'المورد: ${inv.supplierName}',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 16,
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withOpacity(0.15),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(
                                    PurchaseInvoiceModel.statusLabelAr(inv.status),
                                    style: const TextStyle(
                                      color: AppColors.secondary,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'التاريخ: ${inv.invoiceDate.length >= 10 ? inv.invoiceDate.substring(0, 10) : inv.invoiceDate} · الدفع: ${PurchaseInvoiceModel.paymentTypeLabelAr(inv.paymentType)}',
                              style: const TextStyle(color: AppColors.surfaceMuted, fontSize: 12),
                            ),
                            if (inv.costingMethodUsed != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                'طريقة التكلفة: ${StoreSettingsProvider.costingLabelAr(inv.costingMethodUsed)}',
                                style: const TextStyle(color: AppColors.surfaceMuted, fontSize: 11),
                              ),
                            ],
                            const Divider(color: Colors.white24, height: 18),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                _valBox('الإجمالي', inv.totalAmount, symbol),
                                _valBox('المدفوع', inv.paidAmount + inv.settledAmount, symbol),
                                _valBox('المتبقي آجل', inv.remainingAmount, symbol),
                              ],
                            ),
                          ],
                        ),
                      ),

                      if (inv.isDraft) ...[
                        const SizedBox(height: 12),
                        ElevatedButton.icon(
                          onPressed: () => _handlePostDraft(inv),
                          icon: const Icon(Icons.check_circle_outline),
                          label: const Text('اعتماد المسودة وتوريد المخزون الآن'),
                        ),
                      ],

                      const SizedBox(height: 16),
                      const Text(
                        'بنود الأصناف الموردة',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                          color: AppColors.primary,
                        ),
                      ),
                      const SizedBox(height: 8),

                      ...inv.items.map(
                        (line) => Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        line.itemName,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                    Text(
                                      '${_numFormat.format(line.totalLineCost)} $symbol',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'الكمية: ${line.displayQuantity}'
                                  ' · تكلفة الوحدة: ${_numFormat.format(line.unitCostPrice)} $symbol'
                                  ' · سعر البيع: ${_numFormat.format(line.sellPrice)} $symbol',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppColors.textSecondary,
                                  ),
                                ),
                                if (line.returnedQuantity > 0)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Text(
                                      'مرتجع سابق: ${line.displayReturnedQuantity}',
                                      style: const TextStyle(
                                        fontSize: 11,
                                        color: AppColors.lossRed,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                if (inv.isPosted && line.remainingReturnableQty > 0)
                                  Align(
                                    alignment: AlignmentDirectional.centerEnd,
                                    child: TextButton.icon(
                                      onPressed: () => _showReturnModal(inv, line),
                                      icon: const Icon(Icons.assignment_return_outlined, size: 16),
                                      label: const Text('تسجيل مرتجع للمورد'),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),

                      if (inv.returns.isNotEmpty) ...[
                        const SizedBox(height: 14),
                        const Text(
                          'سجل مرتجعات المشتريات على هذه الفاتورة',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                            color: AppColors.lossRed,
                          ),
                        ),
                        const SizedBox(height: 6),
                        ...inv.returns.map(
                          (r) => Card(
                            child: ListTile(
                              leading: const Icon(
                                Icons.assignment_return,
                                color: AppColors.lossRed,
                              ),
                              title: Text('${r.itemName} (كمية: ${r.displayQuantity})'),
                              subtitle: Text(
                                'السبب: ${r.reason} · ${r.refundMethod == "CASH_REFUND" ? "استرداد نقدي" : "خصم من رصيد المورد"}',
                                style: const TextStyle(fontSize: 11),
                              ),
                              trailing: Text(
                                '${_numFormat.format(r.totalAmount)} $symbol',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.lossRed,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _valBox(String label, double val, String symbol) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppColors.surfaceMuted, fontSize: 11)),
        Text(
          '${_numFormat.format(val)} $symbol',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 14,
          ),
        ),
      ],
    );
  }
}
