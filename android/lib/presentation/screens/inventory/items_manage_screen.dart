import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/inventory_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة إدارة وتوريد الأصناف وسياسة البيع الاضطراري — الشاشة 15 (ITEMS_MANAGE / 15-items-manage.jpg)
class ItemsManageScreen extends StatefulWidget {
  const ItemsManageScreen({super.key});

  @override
  State<ItemsManageScreen> createState() => _ItemsManageScreenState();
}

class _ItemsManageScreenState extends State<ItemsManageScreen> {
  final _nameController = TextEditingController();
  final _qtyController = TextEditingController(text: '10');
  final _costPriceController = TextEditingController();
  final _sellPriceController = TextEditingController();
  final _minEmergencyController = TextEditingController();
  final _maxEmergencyController = TextEditingController();

  String _emergencyMode = 'MANUAL_RANGE'; // MANUAL_RANGE | PLUS_FIXED | PLUS_PERCENT | UNRESTRICTED

  @override
  void dispose() {
    _nameController.dispose();
    _qtyController.dispose();
    _costPriceController.dispose();
    _sellPriceController.dispose();
    _minEmergencyController.dispose();
    _maxEmergencyController.dispose();
    super.dispose();
  }

  void _handleSave() async {
    final name = _nameController.text.trim();
    final qty = double.tryParse(_qtyController.text) ?? 0.0;
    final cost = double.tryParse(_costPriceController.text) ?? 0.0;
    final sell = double.tryParse(_sellPriceController.text) ?? 0.0;
    final minEmergency = double.tryParse(_minEmergencyController.text);
    final maxEmergency = double.tryParse(_maxEmergencyController.text);

    if (name.isEmpty || qty <= 0 || cost <= 0 || sell <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى إدخال اسم الصنف والكمية وسعر التكلفة وسعر البيع بشكل صحيح')),
      );
      return;
    }

    final inventory = context.read<InventoryProvider>();
    final success = await inventory.addItem(
      name: name,
      quantity: qty,
      costPrice: cost,
      sellPrice: sell,
      emergencyPriceMode: _emergencyMode,
      minEmergencyPrice: minEmergency,
      maxEmergencyPrice: maxEmergency,
    );

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم توريد وحفظ الصنف بنجاح ✅')),
      );
      Navigator.pop(context);
    } else if (mounted && inventory.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(inventory.errorMessage!)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'إضافة صنف وتوريد مخزون',
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // البيانات الأساسية للصنف
            const Text('البيانات الأساسية والتسعير', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.primary)),
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

            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _qtyController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'الكمية الموردة (كجم/حبة)'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextFormField(
                    controller: _costPriceController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'سعر التكلفة للوحدة (ريال)'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            TextFormField(
              controller: _sellPriceController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'سعر البيع العادي للوحدة (ريال)',
                prefixIcon: Icon(Icons.price_change_outlined),
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
                              decoration: const InputDecoration(labelText: 'أدنى سعر مسموح (ريال)'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextFormField(
                              controller: _maxEmergencyController,
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: const InputDecoration(labelText: 'أقصى سعر مسموح (ريال)'),
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
