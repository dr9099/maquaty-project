import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/inventory_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة تسجيل التالف — الشاشة 10 (DAMAGED_GOODS_ADD / 10-damaged-goods-add.jpg)
class DamagedGoodsScreen extends StatefulWidget {
  const DamagedGoodsScreen({super.key});

  @override
  State<DamagedGoodsScreen> createState() => _DamagedGoodsScreenState();
}

class _DamagedGoodsScreenState extends State<DamagedGoodsScreen> {
  final _qtyController = TextEditingController(text: '1');
  final _reasonController = TextEditingController();
  ItemModel? _selectedItem;
  String? _photoUrl;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<InventoryProvider>().fetchInventory();
    });
  }

  @override
  void dispose() {
    _qtyController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  void _handleRecord() async {
    if (_selectedItem == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى اختيار الصنف التالف')),
      );
      return;
    }

    final qty = double.tryParse(_qtyController.text) ?? 0.0;
    final reason = _reasonController.text.trim();

    if (qty <= 0 || reason.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الكمية التالفة وسبب التلف مطلوبان')),
      );
      return;
    }

    final inventory = context.read<InventoryProvider>();
    final success = await inventory.recordDamagedGoods(
      itemId: _selectedItem!.id,
      quantity: qty,
      reason: reason,
      photoUrl: _photoUrl,
    );

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل التالف وخصمه من المخزون بنجاح ✅')),
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
    final inventory = context.watch<InventoryProvider>();
    final items = inventory.items;

    return AppScaffold(
      title: 'تسجيل بضاعة تالفة',
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.lossRed.withOpacity(0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.lossRed.withOpacity(0.3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.report_problem_outlined, color: AppColors.lossRed),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'يتم خصم الكمية التالفة من المخزون فوراً مع ترحيل قيمتها التكليفية كخسائر تالف (قيد 5450 / 1300)',
                      style: TextStyle(fontSize: 12, color: AppColors.lossRed, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),

            DropdownButtonFormField<ItemModel>(
              value: _selectedItem,
              decoration: const InputDecoration(
                labelText: 'الصنف التالف',
                prefixIcon: Icon(Icons.inventory_2_outlined),
              ),
              items: items.map((item) {
                return DropdownMenuItem<ItemModel>(
                  value: item,
                  child: Text('${item.name} (${item.displayQuantity} متوفر)'),
                );
              }).toList(),
              onChanged: (item) => setState(() => _selectedItem = item),
            ),
            const SizedBox(height: 14),

            TextFormField(
              controller: _qtyController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: _selectedItem != null
                    ? 'الكمية التالفة (${_selectedItem!.unit})'
                    : 'الكمية التالفة',
                prefixIcon: const Icon(Icons.scale_outlined),
              ),
            ),
            const SizedBox(height: 14),

            TextFormField(
              controller: _reasonController,
              decoration: const InputDecoration(
                labelText: 'سبب التلف (إلزامي)',
                prefixIcon: Icon(Icons.comment_outlined),
                hintText: 'مثال: تلف أثناء النقل، حرارة الشمس، فساد بضاعة',
              ),
            ),
            const SizedBox(height: 16),

            // زر إرفاق صورة التالف (BR-014)
            Card(
              child: ListTile(
                leading: Icon(
                  _photoUrl != null ? Icons.check_circle : Icons.camera_alt_outlined,
                  color: _photoUrl != null ? AppColors.cashGreen : AppColors.primary,
                ),
                title: Text(_photoUrl != null ? 'تم إرفاق صورة التالف' : 'التقاط أو إرفاق صورة التالف'),
                subtitle: const Text('لتوثيق التلف ومنع التلاعب (BR-014)', style: TextStyle(fontSize: 11)),
                trailing: TextButton(
                  onPressed: () {
                    setState(() {
                      _photoUrl = 'https://attachments.maqouti.test/damaged-proof.jpg';
                    });
                  },
                  child: const Text('إرفاق صورة'),
                ),
              ),
            ),
            const SizedBox(height: 24),

            ElevatedButton(
              onPressed: _handleRecord,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.lossRed,
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: const Text('تسجيل التالف واعتماده'),
            ),
          ],
        ),
      ),
    );
  }
}
