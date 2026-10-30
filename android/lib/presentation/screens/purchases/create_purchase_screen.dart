import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/quantity_formatter.dart';
import '../../providers/auth_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../providers/purchases_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../providers/suppliers_provider.dart';
import '../../widgets/app_scaffold.dart';

/// نافذة التنبيه الذكية عند اختلاف سعر شراء نفس الصنف في نفس اليوم (قواعد القات 24-48 ساعة)
/// تعرض الخيارات الثلاثة بلهجة بيضاء واضحة ومباشرة للمالك أو العامل المسؤول
Future<String?> showSameDayCostingDialog({
  required BuildContext context,
  required List<CostingConflictItem> conflicts,
  required List<CostingOptionInfo> options,
  required String initialMethod,
  required String currencySymbol,
  String confirmLabel = 'اعتماد وحفظ الفاتورة',
}) {
  String selected = initialMethod;
  final fmt = NumberFormat('#,##0.##', 'ar');

  return showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) {
      return StatefulBuilder(
        builder: (ctx, setDialogState) {
          return Directionality(
            textDirection: TextDirection.rtl,
            child: AlertDialog(
              title: const Row(
                children: [
                  Icon(Icons.price_change, color: AppColors.warning),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'تنبيه: هذا الصنف موجود من اليوم بسعر مختلف!',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'لأن القات سلعة يومية (مدتها 24 إلى 48 ساعة)، إذا بدأ يوم جديد أو نفدت الكمية السابقة نعتمد السعر الجديد تلقائياً. لكن حالياً لا تزال لديك كمية متبقية من نفس اليوم بسعر مختلف — اختر الطريقة التي تناسبك لحساب التكلفة:',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: 10),
                    ...conflicts.map(
                      (c) => Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceMuted,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${c.itemName} (${c.baseUnit})',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: AppColors.primary,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'المتبقي حالياً: ${fmt.format(c.existingQuantity)} بسعر ${fmt.format(c.oldCostPrice)} $currencySymbol\n'
                              'الكمية الجديدة: ${fmt.format(c.newQuantity)} بسعر ${fmt.format(c.newCostPrice)} $currencySymbol\n'
                              'متوسط السعرين لو دمجتهما: ${fmt.format(c.weightedAveragePreview)} $currencySymbol',
                              style: const TextStyle(fontSize: 11, height: 1.4),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Divider(),
                    const Text(
                      'اختر إعداد حساب التكلفة:',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    ...options.map(
                      (opt) => RadioListTile<String>(
                        contentPadding: EdgeInsets.zero,
                        activeColor: AppColors.primary,
                        value: opt.code,
                        groupValue: selected,
                        title: Text(
                          opt.labelAr,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
                        ),
                        subtitle: Text(
                          opt.descriptionAr,
                          style: const TextStyle(fontSize: 11),
                        ),
                        onChanged: (v) {
                          if (v != null) setDialogState(() => selected = v);
                        },
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, null),
                  child: const Text('مراجعة الأسعار'),
                ),
                ElevatedButton(
                  onPressed: () => Navigator.pop(ctx, selected),
                  child: Text(confirmLabel),
                ),
              ],
            ),
          );
        },
      );
    },
  );
}

class _DraftLineControllers {
  String? itemId;
  final nameCtrl = TextEditingController();
  final unitCtrl = TextEditingController(text: 'حبة');
  final baseUnitCtrl = TextEditingController(text: 'حبة');
  final factorCtrl = TextEditingController(text: '1');
  final qtyCtrl = TextEditingController(text: '10');
  final costCtrl = TextEditingController();
  final sellCtrl = TextEditingController();
  final taxCtrl = TextEditingController(text: '0');
  final discountCtrl = TextEditingController(text: '0');

  void dispose() {
    nameCtrl.dispose();
    unitCtrl.dispose();
    baseUnitCtrl.dispose();
    factorCtrl.dispose();
    qtyCtrl.dispose();
    costCtrl.dispose();
    sellCtrl.dispose();
    taxCtrl.dispose();
    discountCtrl.dispose();
  }
}

/// شاشة إنشاء فاتورة شراء متعددة الأصناف (حصري لمالك المتجر)
class CreatePurchaseScreen extends StatefulWidget {
  const CreatePurchaseScreen({super.key});

  @override
  State<CreatePurchaseScreen> createState() => _CreatePurchaseScreenState();
}

class _CreatePurchaseScreenState extends State<CreatePurchaseScreen> {
  final _numFormat = NumberFormat('#,##0.##', 'ar');
  final _supplierRefCtrl = TextEditingController();
  final _headerTaxCtrl = TextEditingController(text: '0');
  final _headerDiscountCtrl = TextEditingController(text: '0');
  final _paidAmountCtrl = TextEditingController(text: '0');
  final _notesCtrl = TextEditingController();

  String? _selectedSupplierId;
  String _paymentType = 'CASH'; // CASH | CREDIT | PARTIAL | ELECTRONIC
  String? _selectedWalletId;
  String? _attachmentPath;
  List<Map<String, dynamic>> _wallets = [];
  final List<_DraftLineControllers> _lines = [_DraftLineControllers()];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final ownerId = context.read<AuthProvider>().currentAccount?.id;
      final suppliersProv = context.read<SuppliersProvider>();
      final inventoryProv = context.read<InventoryProvider>();
      final settingsProv = context.read<StoreSettingsProvider>();
      await suppliersProv.fetchSuppliers(storeOwnerId: ownerId);
      await inventoryProv.fetchInventory();
      await settingsProv.fetchSettings();
      try {
        final res = await ApiClient().get(ApiEndpoints.wallets);
        if (res.data is List && mounted) {
          setState(() {
            _wallets = (res.data as List)
                .map((e) => Map<String, dynamic>.from(e))
                .toList();
            if (_wallets.isNotEmpty) {
              _selectedWalletId = _wallets.first['id']?.toString();
            }
          });
        }
      } catch (_) {}
      if (mounted) {
        final sups = suppliersProv.suppliers;
        if (sups.isNotEmpty && _selectedSupplierId == null) {
          setState(() => _selectedSupplierId = sups.first.id);
        }
      }
    });
  }

  @override
  void dispose() {
    _supplierRefCtrl.dispose();
    _headerTaxCtrl.dispose();
    _headerDiscountCtrl.dispose();
    _paidAmountCtrl.dispose();
    _notesCtrl.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  double get _computedTotal {
    var subtotal = 0.0;
    for (final l in _lines) {
      final q = double.tryParse(l.qtyCtrl.text) ?? 0.0;
      final c = double.tryParse(l.costCtrl.text) ?? 0.0;
      final t = double.tryParse(l.taxCtrl.text) ?? 0.0;
      final d = double.tryParse(l.discountCtrl.text) ?? 0.0;
      subtotal += (q * c) + t - d;
    }
    final hTax = double.tryParse(_headerTaxCtrl.text) ?? 0.0;
    final hDisc = double.tryParse(_headerDiscountCtrl.text) ?? 0.0;
    final total = subtotal + hTax - hDisc;
    return total > 0 ? total : 0.0;
  }

  void _addLine() {
    if (_lines.length >= PurchasesProvider.maxInvoiceLines) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: AppColors.lossRed,
          content: Text('الحد الأقصى لبنود الفاتورة الواحدة هو 200 بند.'),
        ),
      );
      return;
    }
    setState(() => _lines.add(_DraftLineControllers()));
  }

  Future<void> _quickAddSupplier() async {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final created = await showDialog<SupplierModel>(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('إضافة مورد سريع'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                decoration: const InputDecoration(labelText: 'اسم المورد *'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'رقم الهاتف'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
            ElevatedButton(
              onPressed: () async {
                if (nameCtrl.text.trim().length < 2) return;
                final s = await context.read<SuppliersProvider>().createSupplier(
                      name: nameCtrl.text,
                      phone: phoneCtrl.text,
                      storeOwnerId: context.read<AuthProvider>().currentAccount?.id,
                    );
                if (ctx.mounted) Navigator.pop(ctx, s);
              },
              child: const Text('إضافة'),
            ),
          ],
        ),
      ),
    );
    if (created != null && mounted) {
      setState(() => _selectedSupplierId = created.id);
    }
  }

  Future<void> _submit({required String status}) async {
    if (_selectedSupplierId == null || _selectedSupplierId!.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى اختيار المورد أولاً.')),
      );
      return;
    }

    final parsedItems = <PurchaseLineInput>[];
    for (var i = 0; i < _lines.length; i++) {
      final l = _lines[i];
      final name = l.nameCtrl.text.trim();
      final qty = double.tryParse(l.qtyCtrl.text) ?? 0.0;
      final cost = double.tryParse(l.costCtrl.text) ?? -1.0;
      final sell = double.tryParse(l.sellCtrl.text) ?? -1.0;
      final factor = double.tryParse(l.factorCtrl.text) ?? 1.0;
      final unit = l.unitCtrl.text.trim().isEmpty ? 'حبة' : l.unitCtrl.text.trim();
      final baseUnit =
          l.baseUnitCtrl.text.trim().isEmpty ? unit : l.baseUnitCtrl.text.trim();
      if (name.isEmpty || qty <= 0 || cost < 0 || sell <= 0 || factor <= 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('يرجى استكمال بيانات البند رقم ${i + 1} بشكل صحيح.')),
        );
        return;
      }
      if (unit == 'جرام') {
        if (qty != qty.truncateToDouble()) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: AppColors.lossRed,
              content: Text(
                'البند رقم ${i + 1}: الكمية بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.',
              ),
            ),
          );
          return;
        }
      } else if (!ItemModel.isWeightUnitName(unit) && qty != qty.truncateToDouble()) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.lossRed,
            content: Text(
              'البند رقم ${i + 1}: الوحدة ($unit) عددية ولا تقبل الكسور.',
            ),
          ),
        );
        return;
      }
      parsedItems.add(
        PurchaseLineInput(
          itemId: l.itemId,
          itemName: name,
          unit: unit,
          baseUnit: baseUnit,
          conversionFactor: factor,
          quantity: qty,
          unitCostPrice: cost,
          taxAmount: double.tryParse(l.taxCtrl.text) ?? 0.0,
          discountAmount: double.tryParse(l.discountCtrl.text) ?? 0.0,
          sellPrice: sell,
        ),
      );
    }

    if (_paymentType == 'ELECTRONIC' &&
        (_selectedWalletId == null || _selectedWalletId!.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى اختيار المحفظة الإلكترونية للدفع.')),
      );
      return;
    }

    final headerTax = double.tryParse(_headerTaxCtrl.text) ?? 0.0;
    final headerDiscount = double.tryParse(_headerDiscountCtrl.text) ?? 0.0;
    final paidAmt = _paymentType == 'PARTIAL'
        ? (double.tryParse(_paidAmountCtrl.text) ?? 0.0)
        : null;

    final purchasesProv = context.read<PurchasesProvider>();
    final settingsProv = context.read<StoreSettingsProvider>();
    String? chosenCostingMethod;

    // إذا كان الاعتماد فورياً، نفحص تعارض سعر نفس اليوم لعرض الخيارات الثلاثة بالعربية
    if (status == 'POSTED') {
      final preview = await purchasesProv.previewCosting(
        taxAmount: headerTax,
        discountAmount: headerDiscount,
        items: parsedItems,
      );
      if (!mounted) return;
      if (preview != null && preview.hasSameDayPriceConflict) {
        chosenCostingMethod = await showSameDayCostingDialog(
          context: context,
          conflicts: preview.conflicts,
          options: preview.costingOptions,
          initialMethod: preview.defaultCostingMethod,
          currencySymbol: preview.currencySymbol,
        );
        if (chosenCostingMethod == null || !mounted) return;
      } else {
        chosenCostingMethod = settingsProv.defaultCostingMethod;
      }
    }

    final sups = context.read<SuppliersProvider>().suppliers;
    final supName = sups
        .where((s) => s.id == _selectedSupplierId)
        .map((s) => s.name)
        .firstOrNull;

    final created = await purchasesProv.createPurchase(
      supplierId: _selectedSupplierId!,
      supplierNameForOffline: supName,
      supplierInvoiceRef: _supplierRefCtrl.text,
      paymentType: _paymentType,
      walletId: _paymentType == 'ELECTRONIC' ? _selectedWalletId : null,
      taxAmount: headerTax,
      discountAmount: headerDiscount,
      paidAmount: paidAmt,
      attachmentUrl: _attachmentPath,
      notes: _notesCtrl.text,
      status: status,
      costingMethod: chosenCostingMethod,
      items: parsedItems,
      storeOwnerId: context.read<AuthProvider>().currentAccount?.id,
    );

    if (!mounted) return;
    if (created != null) {
      await context.read<InventoryProvider>().fetchInventory();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            status == 'DRAFT'
                ? 'تم حفظ الفاتورة كمسودة بنجاح ✅'
                : 'تم اعتماد فاتورة الشراء وتوريد المخزون بنجاح ✅',
          ),
        ),
      );
      Navigator.pop(context);
    } else if (purchasesProv.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.lossRed,
          content: Text(purchasesProv.errorMessage!),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final suppliersProv = context.watch<SuppliersProvider>();
    final inventoryProv = context.watch<InventoryProvider>();
    final purchasesProv = context.watch<PurchasesProvider>();
    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;

    if (!auth.canManagePurchases) {
      return const AppScaffold(
        title: 'فاتورة شراء جديدة',
        body: Center(child: Text('هذه الشاشة مخصصة لمالك المتجر فقط.')),
      );
    }

    return AppScaffold(
      title: 'فاتورة شراء وتوريد مخزون',
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // 1) اختيار المورد وطريقة الدفع
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'بيانات المورد والدفع',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                            color: AppColors.primary,
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _quickAddSupplier,
                          icon: const Icon(Icons.person_add_alt, size: 16),
                          label: const Text('مورد سريع', style: TextStyle(fontSize: 12)),
                        ),
                      ],
                    ),
                    DropdownButtonFormField<String>(
                      value: suppliersProv.suppliers
                              .any((s) => s.id == _selectedSupplierId)
                          ? _selectedSupplierId
                          : null,
                      decoration: const InputDecoration(labelText: 'اختر المورد *'),
                      items: suppliersProv.suppliers
                          .where((s) => s.isActive)
                          .map((s) => DropdownMenuItem(
                                value: s.id,
                                child: Text('${s.name} ${s.phone != null ? "(${s.phone})" : ""}'),
                              ))
                          .toList(),
                      onChanged: (v) => setState(() => _selectedSupplierId = v),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: _paymentType,
                            decoration: const InputDecoration(labelText: 'طريقة الدفع *'),
                            items: const [
                              DropdownMenuItem(value: 'CASH', child: Text('نقدي (من الصندوق)')),
                              DropdownMenuItem(value: 'CREDIT', child: Text('آجل (على الحساب)')),
                              DropdownMenuItem(value: 'PARTIAL', child: Text('دفع جزئي والباقي آجل')),
                              DropdownMenuItem(value: 'ELECTRONIC', child: Text('محفظة إلكترونية')),
                            ],
                            onChanged: (v) {
                              if (v != null) setState(() => _paymentType = v);
                            },
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextFormField(
                            controller: _supplierRefCtrl,
                            decoration: const InputDecoration(
                              labelText: 'رقم فاتورة المورد (اختياري)',
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (_paymentType == 'ELECTRONIC') ...[
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String>(
                        value: _selectedWalletId,
                        decoration: const InputDecoration(labelText: 'اختر المحفظة *'),
                        items: _wallets
                            .map((w) => DropdownMenuItem<String>(
                                  value: w['id']?.toString(),
                                  child: Text(w['name']?.toString() ?? 'محفظة'),
                                ))
                            .toList(),
                        onChanged: (v) => setState(() => _selectedWalletId = v),
                      ),
                    ],
                    if (_paymentType == 'PARTIAL') ...[
                      const SizedBox(height: 10),
                      TextFormField(
                        controller: _paidAmountCtrl,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: InputDecoration(
                          labelText: 'المبلغ المدفوع الآن ($symbol) *',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            // 2) بنود الأصناف (حتى 200 بند + تعدد الوحدات)
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'بنود الأصناف (${_lines.length} / ${PurchasesProvider.maxInvoiceLines})',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                    color: AppColors.primary,
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: _addLine,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('إضافة بند'),
                ),
              ],
            ),
            const SizedBox(height: 8),

            ...List.generate(_lines.length, (index) {
              final line = _lines[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'البند #${index + 1}',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              color: AppColors.primary,
                            ),
                          ),
                          Row(
                            children: [
                              if (inventoryProv.items.isNotEmpty)
                                PopupMenuButton<ItemModel>(
                                  tooltip: 'اختيار من الأصناف الحالية',
                                  child: const Padding(
                                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                    child: Text(
                                      'اختيار صنف موجود',
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: AppColors.electronicBlue,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  onSelected: (item) {
                                    setState(() {
                                      line.itemId = item.id;
                                      line.nameCtrl.text = item.name;
                                      line.unitCtrl.text = item.unit;
                                      line.baseUnitCtrl.text = item.unit;
                                      line.factorCtrl.text = '1';
                                      if (item.costPrice != null) {
                                        line.costCtrl.text =
                                            item.costPrice!.toStringAsFixed(0);
                                      }
                                      line.sellCtrl.text =
                                          item.sellPrice.toStringAsFixed(0);
                                    });
                                  },
                                  itemBuilder: (_) => inventoryProv.items
                                      .take(20)
                                      .map(
                                        (it) => PopupMenuItem(
                                          value: it,
                                          child: Text('${it.name} (متوفر: ${formatQuantityDisplay(it.quantity, unit: it.unit)})'),
                                        ),
                                      )
                                      .toList(),
                                ),
                              if (_lines.length > 1)
                                IconButton(
                                  icon: const Icon(Icons.delete_outline, color: AppColors.lossRed),
                                  onPressed: () {
                                    setState(() {
                                      final removed = _lines.removeAt(index);
                                      removed.dispose();
                                    });
                                  },
                                ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      TextFormField(
                        controller: line.nameCtrl,
                        onChanged: (_) => line.itemId = null,
                        decoration: const InputDecoration(
                          labelText: 'اسم الصنف * (مثال: قات همداني ممتاز)',
                          isDense: true,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: ['كيلو', 'جرام', 'حبة', 'ربطة', 'حزمة'].map((presetUnit) {
                          final isSelected = line.unitCtrl.text.trim() == presetUnit;
                          return ChoiceChip(
                            label: Text(presetUnit, style: const TextStyle(fontSize: 11)),
                            selected: isSelected,
                            visualDensity: VisualDensity.compact,
                            selectedColor: AppColors.secondary.withOpacity(0.55),
                            onSelected: (_) {
                              setState(() {
                                line.unitCtrl.text = presetUnit;
                                if (presetUnit == 'جرام') {
                                  line.baseUnitCtrl.text = 'كيلو';
                                  line.factorCtrl.text = '0.001';
                                } else if (presetUnit == 'كيلو') {
                                  line.baseUnitCtrl.text = 'كيلو';
                                  line.factorCtrl.text = '1.0';
                                } else if ((double.tryParse(line.factorCtrl.text) ?? 1.0) == 1.0) {
                                  line.baseUnitCtrl.text = presetUnit;
                                }
                              });
                            },
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: line.unitCtrl,
                              onChanged: (v) {
                                if ((double.tryParse(line.factorCtrl.text) ?? 1.0) == 1.0) {
                                  line.baseUnitCtrl.text = v;
                                }
                                setState(() {});
                              },
                              decoration: const InputDecoration(
                                labelText: 'وحدة الشراء (كيلو/حبة/مخصصة)',
                                isDense: true,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextFormField(
                              controller: line.baseUnitCtrl,
                              decoration: const InputDecoration(
                                labelText: 'وحدة البيع الأساسية',
                                isDense: true,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextFormField(
                              controller: line.factorCtrl,
                              keyboardType:
                                  const TextInputType.numberWithOptions(decimal: true),
                              decoration: const InputDecoration(
                                labelText: 'معامل التحويل',
                                isDense: true,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                TextFormField(
                                  controller: line.qtyCtrl,
                                  onChanged: (_) => setState(() {}),
                                  keyboardType: line.unitCtrl.text.trim() == 'جرام'
                                      ? TextInputType.number
                                      : const TextInputType.numberWithOptions(decimal: true),
                                  decoration: InputDecoration(
                                    labelText: line.unitCtrl.text.trim() == 'جرام'
                                        ? 'الكمية (بالجرام) *'
                                        : 'الكمية *',
                                    isDense: true,
                                  ),
                                ),
                                if (line.unitCtrl.text.trim() == 'جرام' || line.unitCtrl.text.trim() == 'كيلو') ...[
                                  const SizedBox(height: 3),
                                  Builder(builder: (_) {
                                    final q = double.tryParse(line.qtyCtrl.text) ?? 0.0;
                                    final effKg = line.unitCtrl.text.trim() == 'جرام' ? q * 0.001 : q;
                                    return Text(
                                      '= ${formatQuantityDisplay(effKg, unit: "كيلو")}',
                                      style: const TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold,
                                        color: AppColors.primary,
                                      ),
                                    );
                                  }),
                                ],
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextFormField(
                              controller: line.costCtrl,
                              onChanged: (_) => setState(() {}),
                              keyboardType:
                                  const TextInputType.numberWithOptions(decimal: true),
                              decoration: InputDecoration(
                                labelText: line.unitCtrl.text.trim() == 'جرام'
                                    ? 'تكلفة الجرام ($symbol) *'
                                    : 'تكلفة الوحدة ($symbol) *',
                                isDense: true,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextFormField(
                              controller: line.sellCtrl,
                              keyboardType:
                                  const TextInputType.numberWithOptions(decimal: true),
                              decoration: InputDecoration(
                                labelText: line.unitCtrl.text.trim() == 'جرام'
                                    ? 'سعر الكيلو ($symbol) *'
                                    : 'سعر البيع ($symbol) *',
                                isDense: true,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),

            // 3) الضرائب والخصومات والمرفقات
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _headerTaxCtrl,
                            onChanged: (_) => setState(() {}),
                            keyboardType:
                                const TextInputType.numberWithOptions(decimal: true),
                            decoration: InputDecoration(
                              labelText: 'ضريبة إضافية ($symbol)',
                              isDense: true,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextFormField(
                            controller: _headerDiscountCtrl,
                            onChanged: (_) => setState(() {}),
                            keyboardType:
                                const TextInputType.numberWithOptions(decimal: true),
                            decoration: InputDecoration(
                              labelText: 'خصم مكتسب ($symbol)',
                              isDense: true,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: () async {
                        final picked = await ImagePicker().pickImage(
                          source: ImageSource.gallery,
                          imageQuality: 75,
                        );
                        if (picked != null) {
                          setState(() => _attachmentPath = picked.path);
                        }
                      },
                      icon: const Icon(Icons.camera_alt_outlined),
                      label: Text(
                        _attachmentPath == null
                            ? 'إرفاق صورة فاتورة المورد الورقية (اختياري)'
                            : 'تم إرفاق صورة الفاتورة ✅',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: _notesCtrl,
                      decoration: const InputDecoration(
                        labelText: 'ملاحظات الفاتورة',
                        isDense: true,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),

            // الإجمالي وأزرار الحفظ
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'صافي إجمالي فاتورة الشراء:',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    '${_numFormat.format(_computedTotal)} $symbol',
                    style: const TextStyle(
                      color: AppColors.secondary,
                      fontWeight: FontWeight.bold,
                      fontSize: 18,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: purchasesProv.isLoading
                        ? null
                        : () => _submit(status: 'DRAFT'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('حفظ كمسودة'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: ElevatedButton.icon(
                    onPressed: purchasesProv.isLoading
                        ? null
                        : () => _submit(status: 'POSTED'),
                    icon: const Icon(Icons.check_circle_outline),
                    label: Text(
                      purchasesProv.isLoading
                          ? 'جاري الاعتماد...'
                          : 'اعتماد وتوريد للمخزون',
                    ),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
