import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/credit_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../providers/sales_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة البيع — الشاشات 4 و5 و14 (SELL / 04-sell-cash.jpg, 05-sell-electronic.jpg, 14-EMERGENCY_SELL_MODAL.jpg)
class SellScreen extends StatefulWidget {
  const SellScreen({super.key});

  @override
  State<SellScreen> createState() => _SellScreenState();
}

class _SellScreenState extends State<SellScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  final _qtyController = TextEditingController(text: '1');
  final _amountController = TextEditingController();
  final _emergencyPriceController = TextEditingController();
  final _emergencyReasonController = TextEditingController();

  ItemModel? _selectedItem;
  String _paymentType = 'CASH'; // CASH | ELECTRONIC | CREDIT
  String? _selectedCustomerId;
  String? _depositAttachmentUrl;
  bool _isEmergency = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<InventoryProvider>().fetchInventory();
      context.read<CreditProvider>().fetchCustomers();
    });
  }

  @override
  void dispose() {
    _qtyController.dispose();
    _amountController.dispose();
    _emergencyPriceController.dispose();
    _emergencyReasonController.dispose();
    super.dispose();
  }

  void _onItemChanged(ItemModel? item) {
    setState(() {
      _selectedItem = item;
      _recalculateAmount();
    });
  }

  void _recalculateAmount() {
    if (_selectedItem == null) return;
    final qty = double.tryParse(_qtyController.text) ?? 1.0;
    final unitPrice = _isEmergency && _emergencyPriceController.text.isNotEmpty
        ? (double.tryParse(_emergencyPriceController.text) ?? _selectedItem!.sellPrice)
        : _selectedItem!.sellPrice;

    final total = qty * unitPrice;
    _amountController.text = total.toStringAsFixed(0);
  }

  void _confirmSaleSheet() {
    if (_selectedItem == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى اختيار الصنف أولاً')),
      );
      return;
    }

    final qty = double.tryParse(_qtyController.text) ?? 0.0;
    final amount = double.tryParse(_amountController.text) ?? 0.0;

    if (qty <= 0 || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الكمية والمبلغ يجب أن يكونا أكبر من صفر')),
      );
      return;
    }

    if (_paymentType == 'CREDIT' && _selectedCustomerId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى اختيار عميل الآجل')),
      );
      return;
    }

    if (_paymentType == 'ELECTRONIC' && (_depositAttachmentUrl == null || _depositAttachmentUrl!.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('صورة إشعار الإيداع إلزامية للدفع الإلكتروني')),
      );
      return;
    }

    if (_isEmergency && _emergencyReasonController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('سبب البيع الاضطراري إلزامي')),
      );
      return;
    }

    showModalBottomSheet(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'تأكيد عملية البيع',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.primary),
              ),
              const SizedBox(height: 14),
              _rowInfo('الصنف', _selectedItem!.name),
              _rowInfo('الكمية', '$qty حبة/كيلو'),
              _rowInfo('المبلغ الإجمالي', '${_currencyFormat.format(amount)} ريال'),
              _rowInfo('طريقة الدفع', _paymentType == 'CASH' ? 'نقداً' : _paymentType == 'ELECTRONIC' ? 'إلكتروني' : 'آجل'),
              if (_isEmergency)
                _rowInfo('نوع البيع', 'اضطراري (${_emergencyReasonController.text})', isAlert: true),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () async {
                  Navigator.pop(ctx);
                  await _executeSale(qty, amount);
                },
                child: const Text('تأكيد وإتمام البيع'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _executeSale(double qty, double amount) async {
    final sales = context.read<SalesProvider>();
    final success = await sales.createSale(
      itemId: _selectedItem!.id,
      quantity: qty,
      amount: amount,
      paymentType: _paymentType,
      creditCustomerId: _selectedCustomerId,
      depositAttachmentUrl: _depositAttachmentUrl,
      isEmergencySale: _isEmergency,
      emergencyOverridePrice: _isEmergency ? double.tryParse(_emergencyPriceController.text) : null,
      emergencyReason: _isEmergency ? _emergencyReasonController.text.trim() : null,
    );

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل عملية البيع بنجاح ✅')),
      );
      context.read<InventoryProvider>().fetchInventory();
      setState(() {
        _qtyController.text = '1';
        _isEmergency = false;
        _emergencyReasonController.clear();
        _emergencyPriceController.clear();
        _depositAttachmentUrl = null;
        _recalculateAmount();
      });
    } else if (mounted && sales.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(sales.errorMessage!)),
      );
    }
  }

  Widget _rowInfo(String title, String val, {bool isAlert = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          Text(
            val,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 13,
              color: isAlert ? AppColors.lossRed : AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final inventory = context.watch<InventoryProvider>();
    final credit = context.watch<CreditProvider>();
    final auth = context.watch<AuthProvider>();
    final items = inventory.items;
    final customers = credit.customers;

    return AppScaffold(
      title: 'تسجيل بيع',
      currentBottomNavIndex: 0,
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // اختيار الصنف
            DropdownButtonFormField<ItemModel>(
              value: _selectedItem,
              decoration: const InputDecoration(
                labelText: 'اختيار الصنف',
                prefixIcon: Icon(Icons.inventory_2_outlined, color: AppColors.textSecondary),
              ),
              items: items.map((item) {
                return DropdownMenuItem<ItemModel>(
                  value: item,
                  child: Text('${item.name} (${item.quantity} متوفر)'),
                );
              }).toList(),
              onChanged: _onItemChanged,
            ),
            const SizedBox(height: 12),

            // شريط معلومات الصنف المختار
            if (_selectedItem != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.secondary.withOpacity(0.18),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('المتوفر: ${_selectedItem!.quantity} كجم/حبة', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    Text('السعر: ${_currencyFormat.format(_selectedItem!.sellPrice)} ريال', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.primary)),
                  ],
                ),
              ),
            const SizedBox(height: 14),

            // حقلا الكمية والمبلغ
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _qtyController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'الكمية'),
                    onChanged: (_) => _recalculateAmount(),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _amountController,
                    readOnly: true,
                    decoration: const InputDecoration(labelText: 'المبلغ الإجمالي (ريال)'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // أزرار طريقة الدفع (نقد / إلكتروني / آجل)
            const Text('طريقة الدفع', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppColors.primary)),
            const SizedBox(height: 8),

            Row(
              children: [
                _paymentBtn('CASH', 'نقداً', Icons.payments_outlined),
                const SizedBox(width: 8),
                _paymentBtn('ELECTRONIC', 'إلكتروني', Icons.account_balance_wallet_outlined),
                if (auth.canManageCredit) ...[
                  const SizedBox(width: 8),
                  _paymentBtn('CREDIT', 'آجل', Icons.credit_card_outlined),
                ],
              ],
            ),
            const SizedBox(height: 14),

            // تفاصيل الدفع الإلكتروني (05-sell-electronic.jpg)
            if (_paymentType == 'ELECTRONIC') ...[
              Card(
                color: AppColors.surfaceMuted,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('إشعار الدفع الإلكتروني (إلزامي)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        icon: Icon(
                          _depositAttachmentUrl != null ? Icons.check_circle : Icons.upload_file,
                          color: _depositAttachmentUrl != null ? AppColors.cashGreen : AppColors.primary,
                        ),
                        label: Text(_depositAttachmentUrl != null ? 'تم إرفاق صورة الإيداع' : 'رفع صورة إشعار الإيداع'),
                        onPressed: () {
                          setState(() {
                            _depositAttachmentUrl = 'https://attachments.maqouti.test/receipt.jpg';
                          });
                        },
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            // تفاصيل الآجل
            if (_paymentType == 'CREDIT') ...[
              DropdownButtonFormField<String>(
                value: _selectedCustomerId,
                decoration: const InputDecoration(
                  labelText: 'اختيار عميل الآجل',
                  prefixIcon: Icon(Icons.person_search_outlined),
                ),
                items: customers.map((c) {
                  return DropdownMenuItem<String>(
                    value: c.id,
                    child: Text('${c.name} (دين: ${_currencyFormat.format(c.totalDebt)})'),
                  );
                }).toList(),
                onChanged: (val) => setState(() => _selectedCustomerId = val),
              ),
              const SizedBox(height: 12),
            ],

            // مفتاح البيع الاضطراري (14-EMERGENCY_SELL_MODAL.jpg)
            Card(
              child: SwitchListTile(
                title: const Text('بيع اضطراري (تعديل السعر)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                subtitle: const Text('لتعديل السعر بوجود ظرف استثنائي مع توثيق السبب والسياسة', style: TextStyle(fontSize: 11)),
                value: _isEmergency,
                activeColor: AppColors.lossRed,
                onChanged: (val) {
                  setState(() {
                    _isEmergency = val;
                    if (val && _selectedItem != null) {
                      _emergencyPriceController.text = _selectedItem!.sellPrice.toStringAsFixed(0);
                    }
                    _recalculateAmount();
                  });
                },
              ),
            ),

            if (_isEmergency) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.lossRed.withOpacity(0.06),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.lossRed.withOpacity(0.3)),
                ),
                child: Column(
                  children: [
                    TextFormField(
                      controller: _emergencyPriceController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'سعر الوحدة الاضطراري (ريال)',
                        prefixIcon: Icon(Icons.price_change_outlined, color: AppColors.lossRed),
                      ),
                      onChanged: (_) => _recalculateAmount(),
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: _emergencyReasonController,
                      decoration: const InputDecoration(
                        labelText: 'سبب التعديل الاضطراري (إلزامي)',
                        prefixIcon: Icon(Icons.comment_outlined, color: AppColors.lossRed),
                        hintText: 'مثال: صنف قديم، تصريف سريع، عميل دائم',
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 24),

            // زر تأكيد البيع
            ElevatedButton(
              onPressed: _confirmSaleSheet,
              style: ElevatedButton.styleFrom(
                backgroundColor: _isEmergency ? AppColors.lossRed : AppColors.primary,
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: const Text('إتمام البيع', style: TextStyle(fontSize: 16)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _paymentBtn(String type, String label, IconData icon) {
    final isSelected = _paymentType == type;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _paymentType = type),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: isSelected ? AppColors.primary : AppColors.border),
          ),
          child: Column(
            children: [
              Icon(icon, size: 20, color: isSelected ? Colors.white : AppColors.textSecondary),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: isSelected ? Colors.white : AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
