import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/quantity_formatter.dart';
import '../../providers/auth_provider.dart';
import '../../providers/credit_provider.dart';
import '../../providers/dashboard_provider.dart';
import '../../providers/inventory_provider.dart';
import '../../providers/sales_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة البيع — الشاشات 4 و5 و14 (SELL / 04-sell-cash.jpg, 05-sell-electronic.jpg, 14-EMERGENCY_SELL_MODAL.jpg)
class SellScreen extends StatefulWidget {
  const SellScreen({super.key});

  @override
  State<SellScreen> createState() => _SellScreenState();
}

class _SellScreenState extends State<SellScreen> {
  final _currencyFormat = NumberFormat('#,##0.##', 'ar');
  final _qtyController = TextEditingController(text: '1');
  final _amountController = TextEditingController();
  final _emergencyPriceController = TextEditingController();
  final _emergencyReasonController = TextEditingController();

  ItemModel? _selectedItem;
  String _paymentType = 'CASH'; // CASH | ELECTRONIC | CREDIT
  String _salesWeightUnit = 'KILO'; // KILO | GRAM (الافتراضي كيلو)
  String? _selectedCustomerId;
  String? _selectedWalletId;
  String? _depositAttachmentUrl;
  List<Map<String, dynamic>> _wallets = [];
  bool _isEmergency = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final storeOwnerId = context.read<AuthProvider>().storeOwnerId;
      context.read<InventoryProvider>().fetchInventory(storeOwnerId: storeOwnerId);
      context.read<CreditProvider>().fetchCustomers(storeOwnerId: storeOwnerId);
      try {
        final res = await ApiClient().get(ApiEndpoints.wallets);
        if (res.data is List && mounted) {
          setState(() {
            _wallets = (res.data as List)
                .map((e) => Map<String, dynamic>.from(e))
                .where((w) => w['is_active'] != false)
                .toList();
            if (_wallets.isNotEmpty) {
              _selectedWalletId = _wallets.first['id']?.toString();
            }
          });
        }
      } catch (_) {}
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
      _salesWeightUnit = 'KILO'; // الافتراضي دائماً كيلو
      if (item != null && !item.isWeightUnit) {
        final curQty = double.tryParse(_qtyController.text) ?? 1.0;
        if (curQty != curQty.truncateToDouble()) {
          _qtyController.text = '1';
        }
      }
      _recalculateAmount();
    });
  }

  void _setQuickFraction(double qty) {
    setState(() {
      _salesWeightUnit = 'KILO';
      _qtyController.text = qty == qty.truncateToDouble()
          ? qty.toStringAsFixed(0)
          : qty.toString();
      _recalculateAmount();
    });
  }

  void _recalculateAmount() {
    if (_selectedItem == null) return;
    final qty = double.tryParse(_qtyController.text) ?? 1.0;
    final unitPrice = _isEmergency && _emergencyPriceController.text.isNotEmpty
        ? (double.tryParse(_emergencyPriceController.text) ?? _selectedItem!.sellPrice)
        : _selectedItem!.sellPrice;

    double total;
    if (_salesWeightUnit == 'GRAM' && _selectedItem!.isKiloUnit) {
      // إدخال بالجرام: إجمالي السعر = (الجرامات ÷ 1000) × سعر الكيلو
      total = (qty / 1000.0) * unitPrice;
    } else {
      total = qty * unitPrice;
    }

    _amountController.text = total == total.truncateToDouble()
        ? total.toStringAsFixed(0)
        : total.toStringAsFixed(2);
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

    if (_salesWeightUnit == 'GRAM') {
      if (qty != qty.truncateToDouble()) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.lossRed,
            content: Text('الكمية بالجرام يجب أن تكون رقماً صحيحاً بدون كسور.'),
          ),
        );
        return;
      }
    } else if (!_selectedItem!.isWeightUnit && qty != qty.truncateToDouble()) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.lossRed,
          content: Text(
            'هذا الصنف يُباع بـ (${_selectedItem!.unit}) ولا يمكن بيعه بالكسور مثل نصف أو ربع.',
          ),
        ),
      );
      return;
    }

    if (_paymentType == 'CREDIT' && _selectedCustomerId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى اختيار عميل الآجل')),
      );
      return;
    }

    if (_paymentType == 'ELECTRONIC' &&
        (_depositAttachmentUrl == null || _depositAttachmentUrl!.isEmpty)) {
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

    if (_isEmergency && _selectedItem != null) {
      final item = _selectedItem!;
      final overridePrice = double.tryParse(_emergencyPriceController.text);
      if (overridePrice == null || overridePrice <= 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('يرجى إدخال سعر وحدة اضطراري صحيح')),
        );
        return;
      }
      final mode = item.emergencyPriceMode;
      final minAllowed = item.effectiveEmergencyMinPrice;
      final maxAllowed = item.effectiveEmergencyMaxPrice;

      if (mode == 'COST_ONLY' && minAllowed != null && minAllowed > 0) {
        if ((overridePrice - minAllowed).abs() > 0.005) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('سياسة الصنف: البيع بسعر التكلفة فقط (${_currencyFormat.format(minAllowed)})')),
          );
          return;
        }
      } else if (mode == 'COST_PLUS' && minAllowed != null && minAllowed > 0) {
        if (overridePrice < minAllowed) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('الحد الأدنى للسعر الاضطراري لهذا الصنف هو ${_currencyFormat.format(minAllowed)}')),
          );
          return;
        }
      } else if (mode == 'RANGE_OR_OPEN') {
        if (minAllowed != null && overridePrice < minAllowed) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('الحد الأدنى للسعر الاضطراري لهذا الصنف هو ${_currencyFormat.format(minAllowed)}')),
          );
          return;
        }
        if (maxAllowed != null && overridePrice > maxAllowed) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('الحد الأعلى للسعر الاضطراري لهذا الصنف هو ${_currencyFormat.format(maxAllowed)}')),
          );
          return;
        }
      }
    }

    final symbol = context.read<StoreSettingsProvider>().currencySymbol;
    final effectiveKiloQty = (_salesWeightUnit == 'GRAM' && _selectedItem!.isKiloUnit)
        ? (qty / 1000.0)
        : qty;
    final qtyDisplay = formatQuantityDisplay(effectiveKiloQty, unit: _selectedItem!.unit);

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
              _rowInfo('الكمية والوزن', qtyDisplay),
              _rowInfo('المبلغ الإجمالي', '${_currencyFormat.format(amount)} $symbol'),
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
    final auth = context.read<AuthProvider>();
    final success = await sales.createSale(
      itemId: _selectedItem!.id,
      quantity: qty,
      quantityUnit: (_salesWeightUnit == 'GRAM' && _selectedItem!.isKiloUnit) ? 'GRAM' : 'KILO',
      amount: amount,
      paymentType: _paymentType,
      walletId: _paymentType == 'ELECTRONIC' ? _selectedWalletId : null,
      creditCustomerId: _selectedCustomerId,
      depositAttachmentUrl: _depositAttachmentUrl,
      isEmergencySale: _isEmergency,
      emergencyOverridePrice: _isEmergency ? double.tryParse(_emergencyPriceController.text) : null,
      emergencyReason: _isEmergency ? _emergencyReasonController.text.trim() : null,
      storeOwnerId: auth.storeOwnerId,
      workerId: auth.workerId,
      isOwner: auth.isOwner,
      isResponsibleWorker: auth.isResponsibleWorker,
    );

    if (success && mounted) {
      if (sales.lastAccountStatus != null) {
        context.read<AuthProvider>().updateAccountStatus(sales.lastAccountStatus!);
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            sales.lastOperationQueuedOffline
                ? 'تم حفظ عملية البيع محلياً وستتم مزامنتها تلقائياً عند توفر الاتصال ✅'
                : 'تم تسجيل عملية البيع بنجاح ✅',
          ),
        ),
      );
      context.read<InventoryProvider>().fetchInventory(storeOwnerId: auth.storeOwnerId);
      try {
        context.read<DashboardProvider>().fetchSummary();
      } catch (_) {}
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

    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;
    final currentQty = double.tryParse(_qtyController.text) ?? 1.0;

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
                  child: Text('${item.name} (${formatQuantityDisplay(item.quantity, unit: item.unit)} متوفر)'),
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
                    Text(
                      'المتوفر: ${formatQuantityDisplay(_selectedItem!.quantity, unit: _selectedItem!.unit)}',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'سعر الـ ${_selectedItem!.unit}: ${_currencyFormat.format(_selectedItem!.sellPrice)} $symbol',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppColors.primary,
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 12),

            // أزرار التجزئة السريعة واختيار وحدة الإدخال (كيلو / جرام)
            if (_selectedItem != null && _selectedItem!.isKiloUnit) ...[
              Row(
                children: [
                  const Text(
                    'وحدة الإدخال: ',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  ChoiceChip(
                    label: const Text('كيلو', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    selected: _salesWeightUnit == 'KILO',
                    selectedColor: AppColors.secondary.withOpacity(0.6),
                    onSelected: (selected) {
                      if (selected && _salesWeightUnit != 'KILO') {
                        setState(() {
                          _salesWeightUnit = 'KILO';
                          final cur = double.tryParse(_qtyController.text) ?? 1000.0;
                          _qtyController.text = (cur / 1000.0).toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');
                          _recalculateAmount();
                        });
                      }
                    },
                  ),
                  const SizedBox(width: 8),
                  ChoiceChip(
                    label: const Text('جرام', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    selected: _salesWeightUnit == 'GRAM',
                    selectedColor: AppColors.secondary.withOpacity(0.6),
                    onSelected: (selected) {
                      if (selected && _salesWeightUnit != 'GRAM') {
                        setState(() {
                          _salesWeightUnit = 'GRAM';
                          final cur = double.tryParse(_qtyController.text) ?? 1.0;
                          _qtyController.text = (cur * 1000).toInt().toString();
                          _recalculateAmount();
                        });
                      }
                    },
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // أزرار التجزئة السريعة للكيلو (تظهر فقط عند اختيار وحدة الكيلو)
              if (_salesWeightUnit == 'KILO') ...[
                const Text(
                  'مقدار البيع (حساب تلقائي من سعر الكيلو)',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: ChoiceChip(
                        label: Text(
                          'كيلو (${_currencyFormat.format(_selectedItem!.sellPrice)})',
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                        selected: currentQty == 1.0,
                        selectedColor: AppColors.secondary.withOpacity(0.6),
                        onSelected: (_) => _setQuickFraction(1.0),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: ChoiceChip(
                        label: Text(
                          'نصف كيلو (${_currencyFormat.format(_selectedItem!.sellPrice * 0.5)})',
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                        selected: currentQty == 0.5,
                        selectedColor: AppColors.secondary.withOpacity(0.6),
                        onSelected: (_) => _setQuickFraction(0.5),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: ChoiceChip(
                        label: Text(
                          'ربع كيلو (${_currencyFormat.format(_selectedItem!.sellPrice * 0.25)})',
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                        selected: currentQty == 0.25,
                        selectedColor: AppColors.secondary.withOpacity(0.6),
                        onSelected: (_) => _setQuickFraction(0.25),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
            ],

            // حقلا الكمية والمبلغ
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextFormField(
                        controller: _qtyController,
                        keyboardType: _salesWeightUnit == 'GRAM'
                            ? TextInputType.number
                            : TextInputType.numberWithOptions(
                                decimal: _selectedItem?.isWeightUnit ?? true,
                              ),
                        decoration: InputDecoration(
                          labelText: _selectedItem != null
                              ? (_salesWeightUnit == 'GRAM'
                                  ? 'الوزن بالجرام (جم)'
                                  : 'الكمية (${_selectedItem!.unit})')
                              : 'الكمية',
                        ),
                        onChanged: (_) {
                          setState(() => _recalculateAmount());
                        },
                      ),
                      if (_selectedItem != null && _selectedItem!.isKiloUnit) ...[
                        const SizedBox(height: 4),
                        Builder(
                          builder: (_) {
                            final rawQty = double.tryParse(_qtyController.text) ?? 0.0;
                            final effKg = _salesWeightUnit == 'GRAM' ? rawQty / 1000.0 : rawQty;
                            final helper = formatQuantityDisplay(effKg, unit: 'كيلو');
                            return Text(
                              '= $helper',
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: AppColors.primary,
                              ),
                            );
                          },
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _amountController,
                    readOnly: true,
                    decoration: InputDecoration(labelText: 'المبلغ الإجمالي ($symbol)'),
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
                      if (_wallets.isNotEmpty) ...[
                        DropdownButtonFormField<String>(
                          value: _selectedWalletId,
                          decoration: const InputDecoration(
                            labelText: 'اختيار المحفظة الإلكترونية *',
                            prefixIcon: Icon(Icons.account_balance_wallet_outlined),
                            isDense: true,
                          ),
                          items: _wallets
                              .map(
                                (w) => DropdownMenuItem<String>(
                                  value: w['id']?.toString(),
                                  child: Text(w['name']?.toString() ?? 'محفظة'),
                                ),
                              )
                              .toList(),
                          onChanged: (val) => setState(() => _selectedWalletId = val),
                        ),
                        const SizedBox(height: 10),
                      ],
                      const Text(
                        'إشعار الدفع الإلكتروني (إلزامي)',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              icon: Icon(
                                _depositAttachmentUrl != null
                                    ? Icons.check_circle
                                    : Icons.camera_alt_outlined,
                                color: _depositAttachmentUrl != null
                                    ? AppColors.cashGreen
                                    : AppColors.primary,
                              ),
                              label: Text(
                                _depositAttachmentUrl != null
                                    ? 'تم إرفاق صورة الإيداع ✅'
                                    : 'تصوير / اختيار إشعار الإيداع',
                              ),
                              onPressed: () async {
                                final messenger = ScaffoldMessenger.of(context);
                                try {
                                  final picked = await ImagePicker().pickImage(
                                    source: ImageSource.gallery,
                                    imageQuality: 75,
                                  );
                                  if (picked != null && mounted) {
                                    setState(() => _depositAttachmentUrl = picked.path);
                                  }
                                } catch (_) {
                                  if (mounted) {
                                    messenger.showSnackBar(
                                      const SnackBar(
                                        backgroundColor: AppColors.lossRed,
                                        content: Text(
                                          'تعذر اختيار صورة إشعار الإيداع. يرجى التحقق من صلاحيات الصور.',
                                        ),
                                      ),
                                    );
                                  }
                                }
                              },
                            ),
                          ),
                        ],
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
                      final item = _selectedItem!;
                      double defaultEmergPrice = item.sellPrice;
                      final minEmerg = item.effectiveEmergencyMinPrice;
                      if (minEmerg != null && minEmerg > 0) {
                        defaultEmergPrice = minEmerg;
                      }
                      _emergencyPriceController.text = defaultEmergPrice.toStringAsFixed(0);
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
                      decoration: InputDecoration(
                        labelText: 'سعر الوحدة الاضطراري ($symbol)',
                        prefixIcon: const Icon(Icons.price_change_outlined, color: AppColors.lossRed),
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
