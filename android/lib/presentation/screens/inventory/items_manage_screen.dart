import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../providers/purchases_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';
import '../purchases/create_purchase_screen.dart';

/// شاشة إدارة وتوريد الأصناف وسياسة البيع الاضطراري — الشاشة 15 (ITEMS_MANAGE / 15-items-manage.jpg)
class ItemsManageScreen extends StatefulWidget {
  const ItemsManageScreen({super.key});

  @override
  State<ItemsManageScreen> createState() => _ItemsManageScreenState();
}

class _ItemsManageScreenState extends State<ItemsManageScreen> {
  static const List<String> _presetUnits = [
    'كيلو',
    'حبة',
    'ربطة',
    'حزمة',
    'مخصصة',
  ];

  final _nameController = TextEditingController();
  final _customUnitController = TextEditingController();
  final _qtyController = TextEditingController(text: '10');
  final _costPriceController = TextEditingController();
  final _sellPriceController = TextEditingController();
  final _minEmergencyController = TextEditingController();
  final _maxEmergencyController = TextEditingController();

  String _selectedUnitOption = 'كيلو';
  String _emergencyMode = 'MANUAL_RANGE'; // MANUAL_RANGE | PLUS_FIXED | PLUS_PERCENT | UNRESTRICTED

  @override
  void dispose() {
    _nameController.dispose();
    _customUnitController.dispose();
    _qtyController.dispose();
    _costPriceController.dispose();
    _sellPriceController.dispose();
    _minEmergencyController.dispose();
    _maxEmergencyController.dispose();
    super.dispose();
  }

  String get _resolvedUnit {
    if (_selectedUnitOption == 'مخصصة') {
      final custom = _customUnitController.text.trim();
      return custom.isEmpty ? 'حبة' : custom;
    }
    return _selectedUnitOption;
  }

  void _handleSave() async {
    final name = _nameController.text.trim();
    final unit = _resolvedUnit;
    final qty = double.tryParse(_qtyController.text) ?? 0.0;
    final cost = double.tryParse(_costPriceController.text) ?? 0.0;
    final sell = double.tryParse(_sellPriceController.text) ?? 0.0;
    final minEmergency = double.tryParse(_minEmergencyController.text);
    final maxEmergency = double.tryParse(_maxEmergencyController.text);

    if (_selectedUnitOption == 'مخصصة' && _customUnitController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى كتابة اسم الوحدة المخصصة أولاً')),
      );
      return;
    }

    if (name.isEmpty || qty <= 0 || cost <= 0 || sell <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى إدخال اسم الصنف والكمية وسعر التكلفة وسعر البيع بشكل صحيح')),
      );
      return;
    }

    if (!ItemModel.isWeightUnitName(unit) && qty != qty.truncateToDouble()) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.lossRed,
          content: Text(
            'هذا الصنف يُباع بـ ($unit) ولا يقبل الكسور مثل نصف أو ربع.',
          ),
        ),
      );
      return;
    }

    final inventory = context.read<InventoryProvider>();
    final settings = context.read<StoreSettingsProvider>();

    var success = await inventory.addItem(
      name: name,
      unit: unit,
      quantity: qty,
      costPrice: cost,
      sellPrice: sell,
      emergencyPriceMode: _emergencyMode,
      minEmergencyPrice: minEmergency,
      maxEmergencyPrice: maxEmergency,
      promptOnSameDayPriceDiff: true,
    );

    if (!success &&
        mounted &&
        inventory.lastApiException?.code == 'COSTING_METHOD_REQUIRED') {
      final rawDetails = inventory.lastApiException?.details;
      final details = rawDetails is Map
          ? Map<String, dynamic>.from(rawDetails)
          : <String, dynamic>{};

      final List<CostingConflictItem> parsedConflicts =
          details['conflicts'] is List && (details['conflicts'] as List).isNotEmpty
          ? (details['conflicts'] as List)
              .map((c) => CostingConflictItem.fromJson(Map<String, dynamic>.from(c)))
              .toList()
          : [
              CostingConflictItem(
                itemName: (details['item_name'] ?? name).toString(),
                baseUnit: (details['unit'] ?? unit).toString(),
                existingQuantity:
                    (details['existing_quantity'] as num?)?.toDouble() ?? 0.0,
                oldCostPrice:
                    ((details['old_cost_price'] ?? details['existing_cost_price'])
                            as num?)
                        ?.toDouble() ??
                    0.0,
                newQuantity:
                    ((details['new_quantity'] ?? details['incoming_quantity'])
                            as num?)
                        ?.toDouble() ??
                    qty,
                newCostPrice:
                    ((details['new_cost_price'] ?? details['incoming_cost_price'])
                            as num?)
                        ?.toDouble() ??
                    cost,
                weightedAveragePreview:
                    ((details['weighted_average_preview'] ??
                                details['weighted_average_cost'])
                            as num?)
                        ?.toDouble() ??
                    cost,
              ),
            ];

      final options = details['costing_options'] is List
          ? (details['costing_options'] as List)
              .map((e) => CostingOptionInfo.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : settings.costingOptions;

      final chosenMethod = await showSameDayCostingDialog(
        context: context,
        conflicts: parsedConflicts,
        options: options,
        initialMethod: (details['default_costing_method'] ??
                settings.defaultCostingMethod)
            .toString(),
        currencySymbol: settings.currencySymbol,
        confirmLabel: 'اعتماد وحفظ الصنف',
      );

      if (chosenMethod == null || !mounted) return;

      success = await inventory.addItem(
        name: name,
        unit: unit,
        quantity: qty,
        costPrice: cost,
        sellPrice: sell,
        emergencyPriceMode: _emergencyMode,
        minEmergencyPrice: minEmergency,
        maxEmergencyPrice: maxEmergency,
        costingMethod: chosenMethod,
        promptOnSameDayPriceDiff: false,
      );
    }

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم توريد وحفظ الصنف بنجاح ✅')),
      );
      Navigator.pop(context);
    } else if (mounted && inventory.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.lossRed,
          content: Text(inventory.errorMessage!),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;

    if (!auth.canManagePurchases) {
      return const AppScaffold(
        title: 'إضافة صنف وتوريد مخزون',
        body: Center(
          child: Text('لا تملك صلاحية الوصول إلى هذه الشاشة.'),
        ),
      );
    }

    final isWeight = ItemModel.isWeightUnitName(_resolvedUnit);

    return AppScaffold(
      title: 'إضافة صنف وتوريد مخزون',
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // مواءمة التوريد المخزني المباشر مع فواتير الشراء الرسمية بدون ازدواجية (D-01 / BR-003)
            Container(
              margin: const EdgeInsets.only(bottom: 14),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.secondary.withOpacity(0.18),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.primary.withOpacity(0.25)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'توريد مخزني مباشر (أرصدة افتتاحية / إنتاج مزرعة خاصة)',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'إذا كنت تشتري البضاعة من مورد وترغب بتوثيق فاتورة الشراء والقيد المحاسبي وذمة المورد، استخدم فاتورة شراء رسمية بدلاً من هذه الشاشة لمنع الازدواجية.',
                    style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 6),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: OutlinedButton.icon(
                      onPressed: () =>
                          Navigator.pushReplacementNamed(context, '/purchases/create'),
                      icon: const Icon(Icons.shopping_bag_outlined, size: 16),
                      label: const Text(
                        'الانتقال إلى فاتورة شراء من مورد',
                        style: TextStyle(fontSize: 12),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // البيانات الأساسية للصنف
            Text(
              'البيانات الأساسية والتسعير ($symbol)',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.primary),
            ),
            const SizedBox(height: 12),

            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'اسم صنف القات',
                prefixIcon: Icon(Icons.spa_outlined),
                hintText: 'مثال: قات همداني، شامي، سوطي',
              ),
            ),
            const SizedBox(height: 12),

            // اختيار نوع الوحدة الخاصة بهذا الصنف
            const Text(
              'وحدة البيع والتعامل الخاصة بهذا الصنف',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: _presetUnits.map((u) {
                final selected = _selectedUnitOption == u;
                return ChoiceChip(
                  label: Text(u == 'مخصصة' ? 'وحدة مخصصة' : u),
                  selected: selected,
                  selectedColor: AppColors.secondary.withOpacity(0.55),
                  onSelected: (_) {
                    setState(() {
                      _selectedUnitOption = u;
                      if (!ItemModel.isWeightUnitName(_resolvedUnit)) {
                        final cur = double.tryParse(_qtyController.text);
                        if (cur != null && cur != cur.truncateToDouble()) {
                          _qtyController.text = cur.ceil().toString();
                        }
                      }
                    });
                  },
                );
              }).toList(),
            ),
            if (_selectedUnitOption == 'مخصصة') ...[
              const SizedBox(height: 10),
              TextFormField(
                controller: _customUnitController,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'اسم الوحدة المخصصة (يحددها المالك)',
                  hintText: 'مثال: علاقي، سلة، كيس صغير',
                  prefixIcon: Icon(Icons.straighten_outlined),
                ),
              ),
            ],
            const SizedBox(height: 6),
            Text(
              isWeight
                  ? 'وحدة الوزن ($_resolvedUnit): يدعم البيع بالكيلو ونصف الكيلو وربع الكيلو وبالجرام مع حساب السعر تلقائياً.'
                  : 'وحدة عددية ($_resolvedUnit): يُباع بالعدد الصحيح فقط ولا يقبل الكسور.',
              style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 12),

            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _qtyController,
                    keyboardType: TextInputType.numberWithOptions(decimal: isWeight),
                    decoration: InputDecoration(labelText: 'الكمية الموردة ($_resolvedUnit)'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextFormField(
                    controller: _costPriceController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(labelText: 'سعر التكلفة للـ $_resolvedUnit ($symbol)'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            TextFormField(
              controller: _sellPriceController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: 'سعر البيع الأساسي للـ $_resolvedUnit ($symbol)',
                prefixIcon: const Icon(Icons.price_change_outlined),
              ),
            ),
            const SizedBox(height: 20),

            // ضبط سياسة البيع الاضطراري (R-14 / R-15 / 15-items-manage.jpg)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'سياسة البيع الاضطراري لهذا الصنف',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppColors.primary),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'تحدد الحد الأدنى المسموح للعمال عند البيع الاضطراري لمنع الخسائر غير المصرح بها',
                      style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 12),

                    DropdownButtonFormField<String>(
                      value: _emergencyMode,
                      decoration: const InputDecoration(labelText: 'نمط السياسة الاضطرارية'),
                      items: const [
                        DropdownMenuItem(value: 'MANUAL_RANGE', child: Text('نطاق سعري محدد يدوياً (حد أدنى وأقصى)')),
                        DropdownMenuItem(value: 'PLUS_FIXED', child: Text('هامش ربح ثابت فوق التكلفة')),
                        DropdownMenuItem(value: 'PLUS_PERCENT', child: Text('نسبة مئوية فوق التكلفة')),
                        DropdownMenuItem(value: 'UNRESTRICTED', child: Text('غير مقيد (أي سعر فوق الصفر)')),
                      ],
                      onChanged: (val) => setState(() => _emergencyMode = val ?? 'MANUAL_RANGE'),
                    ),
                    const SizedBox(height: 12),

                    if (_emergencyMode == 'MANUAL_RANGE')
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: _minEmergencyController,
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: InputDecoration(labelText: 'أدنى سعر مسموح ($symbol)'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextFormField(
                              controller: _maxEmergencyController,
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: InputDecoration(labelText: 'أقصى سعر مسموح ($symbol)'),
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            ElevatedButton(
              onPressed: _handleSave,
              style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              child: const Text('حفظ وتوريد الصنف للمخزون'),
            ),
          ],
        ),
      ),
    );
  }
}
