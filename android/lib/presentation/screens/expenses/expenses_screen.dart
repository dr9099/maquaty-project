import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/error_formatter.dart';
import '../../providers/auth_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة المصروفات والسلف والمصروفات المستحقة (نقد / محفظة / آجل 2100 + فصل 5300 عن 5700)
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen>
    with SingleTickerProviderStateMixin {
  final _currencyFormat = NumberFormat('#,##0.##', 'ar');
  late TabController _tabController;
  bool _isLoading = true;
  List<Map<String, dynamic>> _expenses = [];
  List<Map<String, dynamic>> _employees = [];
  List<Map<String, dynamic>> _wallets = [];
  double _totalUnpaidAccruals = 0.0;
  int _activeTab = 0;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    final tabCount = auth.isOwner ? 6 : 1;
    _tabController = TabController(length: tabCount, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging && mounted) {
        setState(() => _activeTab = _tabController.index);
      }
    });
    _fetchExpenses();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchExpenses() async {
    setState(() => _isLoading = true);
    try {
      final api = ApiClient();
      final res = await api.get(ApiEndpoints.expenses);
      List<Map<String, dynamic>> walletsList = [];
      try {
        final wRes = await api.get(ApiEndpoints.wallets);
        if (wRes.data is List) {
          walletsList = (wRes.data as List)
              .map((e) => Map<String, dynamic>.from(e))
              .where((w) => w['is_active'] != false)
              .toList();
        }
      } catch (_) {}

      if (!mounted) return;
      if (res.data is Map) {
        final map = Map<String, dynamic>.from(res.data);
        final rawRecords = map['records'] is List ? (map['records'] as List) : [];
        final rawEmployees =
            map['employees'] is List ? (map['employees'] as List) : [];
        setState(() {
          _expenses =
              rawRecords.map((e) => Map<String, dynamic>.from(e)).toList();
          _employees =
              rawEmployees.map((e) => Map<String, dynamic>.from(e)).toList();
          _totalUnpaidAccruals =
              (map['total_unpaid_accruals'] as num?)?.toDouble() ?? 0.0;
          _wallets = walletsList;
          _isLoading = false;
        });
      } else if (res.data is List) {
        setState(() {
          _expenses = (res.data as List)
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          _wallets = walletsList;
          _isLoading = false;
        });
      } else {
        setState(() => _isLoading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List<Map<String, dynamic>> _filteredExpenses(bool isOwner) {
    if (!isOwner) return _expenses;
    switch (_activeTab) {
      case 1: // خدمات (5300)
        return _expenses.where((e) => e['account_code'] == '5300').toList();
      case 2: // مصروفات أخرى (5700)
        return _expenses.where((e) => e['account_code'] == '5700').toList();
      case 3: // إيجار (5200)
        return _expenses.where((e) => e['type'] == 'RENT').toList();
      case 4: // رواتب وسلف (5100 / 5500)
        return _expenses
            .where((e) =>
                e['type'] == 'SALARY' ||
                e['type'] == 'ADVANCE' ||
                e['type'] == 'WORKER_ADVANCE')
            .toList();
      case 5: // مستحقات غير مسددة (2100)
        return _expenses
            .where(((e) => ((e['remaining_amount'] as num?)?.toDouble() ?? 0) > 0))
            .toList();
      case 0:
      default:
        return _expenses;
    }
  }

  void _showAddExpenseDialog() {
    final symbol = context.read<StoreSettingsProvider>().currencySymbol;
    final amountController = TextEditingController();
    final descController = TextEditingController();
    final receiverController = TextEditingController();
    String selectedType = 'ELECTRICITY';
    String paymentMethod = 'CASH'; // CASH | ELECTRONIC | CREDIT
    String? selectedWalletId =
        _wallets.isNotEmpty ? _wallets.first['id']?.toString() : null;
    String? selectedEmployeeId =
        _employees.isNotEmpty ? _employees.first['id']?.toString() : null;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) {
          final allowsCredit = selectedType != 'ADVANCE';
          if (!allowsCredit && paymentMethod == 'CREDIT') {
            paymentMethod = 'CASH';
          }

          return Directionality(
            textDirection: TextDirection.rtl,
            child: Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 20,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'تسجيل مصروف متجر جديد',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: selectedType,
                      decoration: const InputDecoration(labelText: 'بند / تصنيف المصروف *'),
                      items: const [
                        DropdownMenuItem(
                          value: 'ELECTRICITY',
                          child: Text('كهرباء (خدمات - حساب 5300)'),
                        ),
                        DropdownMenuItem(
                          value: 'WATER',
                          child: Text('مياه (خدمات - حساب 5300)'),
                        ),
                        DropdownMenuItem(
                          value: 'INTERNET',
                          child: Text('إنترنت واتصالات (خدمات - حساب 5300)'),
                        ),
                        DropdownMenuItem(
                          value: 'OTHER',
                          child: Text('مصروفات أخرى للمتجر (مستقل - حساب 5700)'),
                        ),
                        DropdownMenuItem(
                          value: 'RENT',
                          child: Text('إيجار المتجر (حساب 5200)'),
                        ),
                        DropdownMenuItem(
                          value: 'SALARY',
                          child: Text('راتب / أجر موظف (حساب 5100)'),
                        ),
                        DropdownMenuItem(
                          value: 'ADVANCE',
                          child: Text('سلفة موظف (حساب 5500)'),
                        ),
                      ],
                      onChanged: (val) {
                        if (val != null) setSheetState(() => selectedType = val);
                      },
                    ),
                    if ((selectedType == 'SALARY' || selectedType == 'ADVANCE') &&
                        _employees.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String>(
                        value: selectedEmployeeId,
                        decoration: const InputDecoration(labelText: 'اختر الموظف *'),
                        items: _employees
                            .map(
                              (emp) => DropdownMenuItem<String>(
                                value: emp['id']?.toString(),
                                child: Text(emp['name']?.toString() ?? 'موظف'),
                              ),
                            )
                            .toList(),
                        onChanged: (v) => setSheetState(() => selectedEmployeeId = v),
                      ),
                    ],
                    if (selectedType == 'RENT') ...[
                      const SizedBox(height: 10),
                      TextField(
                        controller: receiverController,
                        decoration: const InputDecoration(
                          labelText: 'اسم المؤجر / المستلم',
                        ),
                      ),
                    ],
                    const SizedBox(height: 10),
                    TextField(
                      controller: amountController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(labelText: 'المبلغ ($symbol) *'),
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      value: paymentMethod,
                      decoration: const InputDecoration(labelText: 'طريقة السداد / القيد *'),
                      items: [
                        const DropdownMenuItem(
                          value: 'CASH',
                          child: Text('نقداً من الصندوق (1000)'),
                        ),
                        const DropdownMenuItem(
                          value: 'ELECTRONIC',
                          child: Text('محفظة إلكترونية'),
                        ),
                        if (allowsCredit)
                          const DropdownMenuItem(
                            value: 'CREDIT',
                            child: Text('آجل / مستحق غير مدفوع الآن (حساب 2100)'),
                          ),
                      ],
                      onChanged: (val) {
                        if (val != null) setSheetState(() => paymentMethod = val);
                      },
                    ),
                    if (paymentMethod == 'ELECTRONIC') ...[
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String>(
                        value: selectedWalletId,
                        decoration: const InputDecoration(
                          labelText: 'اختر المحفظة الإلكترونية *',
                        ),
                        items: _wallets
                            .map(
                              (w) => DropdownMenuItem<String>(
                                value: w['id']?.toString(),
                                child: Text(w['name']?.toString() ?? 'محفظة'),
                              ),
                            )
                            .toList(),
                        onChanged: (v) => setSheetState(() => selectedWalletId = v),
                      ),
                    ],
                    const SizedBox(height: 10),
                    TextField(
                      controller: descController,
                      decoration: InputDecoration(
                        labelText: selectedType == 'OTHER'
                            ? 'بيان المصروف الآخر * (مثال: أكياس، ضيافة، نظافة)'
                            : 'ملاحظات / بيان المصروف',
                      ),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () async {
                        final amt = double.tryParse(amountController.text) ?? 0.0;
                        final desc = descController.text.trim();
                        if (amt <= 0) return;
                        if (selectedType == 'OTHER' && desc.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('يرجى كتابة بيان المصروف الآخر'),
                            ),
                          );
                          return;
                        }
                        if (paymentMethod == 'ELECTRONIC' &&
                            (selectedWalletId == null || selectedWalletId!.isEmpty)) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              backgroundColor: AppColors.lossRed,
                              content: Text('يرجى اختيار المحفظة الإلكترونية'),
                            ),
                          );
                          return;
                        }

                        try {
                          final api = ApiClient();
                          await api.post(
                            ApiEndpoints.expenses,
                            data: {
                              'type': selectedType,
                              'amount': amt,
                              'paymentMethod': paymentMethod,
                              if (paymentMethod == 'ELECTRONIC')
                                'walletId': selectedWalletId,
                              if (selectedType == 'OTHER') 'utilityTypeOther': desc,
                              if (desc.isNotEmpty) 'note': desc,
                              if (selectedType == 'RENT' &&
                                  receiverController.text.trim().isNotEmpty)
                                'receiverName': receiverController.text.trim(),
                              if ((selectedType == 'SALARY' ||
                                      selectedType == 'ADVANCE') &&
                                  selectedEmployeeId != null)
                                'employeeId': selectedEmployeeId,
                            },
                          );
                          if (!mounted) return;
                          if (ctx.mounted) Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('تم تسجيل المصروف بنجاح ✅')),
                          );
                          _fetchExpenses();
                        } catch (e) {
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                backgroundColor: AppColors.lossRed,
                                content: Text(formatUserError(e)),
                              ),
                            );
                          }
                        }
                      },
                      child: const Text('حفظ المصروف'),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  void _showSettleAccrualDialog(Map<String, dynamic> ex) {
    final symbol = context.read<StoreSettingsProvider>().currencySymbol;
    final remaining = (ex['remaining_amount'] as num?)?.toDouble() ?? 0.0;
    final amountCtrl = TextEditingController(text: remaining.toStringAsFixed(0));
    final noteCtrl = TextEditingController();
    String paymentMethod = 'CASH';
    String? selectedWalletId =
        _wallets.isNotEmpty ? _wallets.first['id']?.toString() : null;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text(
              'سداد مصروف مستحق (حساب 2100)',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'المتبقي غير المسدد: ${_currencyFormat.format(remaining)} $symbol',
                  style: const TextStyle(
                    color: AppColors.lossRed,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: amountCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: 'مبلغ السداد ($symbol) *'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: paymentMethod,
                  decoration: const InputDecoration(labelText: 'طريقة الدفع *'),
                  items: const [
                    DropdownMenuItem(value: 'CASH', child: Text('نقداً من الصندوق')),
                    DropdownMenuItem(
                      value: 'ELECTRONIC',
                      child: Text('محفظة إلكترونية'),
                    ),
                  ],
                  onChanged: (v) {
                    if (v != null) setDialogState(() => paymentMethod = v);
                  },
                ),
                if (paymentMethod == 'ELECTRONIC') ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: selectedWalletId,
                    decoration: const InputDecoration(labelText: 'المحفظة *'),
                    items: _wallets
                        .map(
                          (w) => DropdownMenuItem<String>(
                            value: w['id']?.toString(),
                            child: Text(w['name']?.toString() ?? 'محفظة'),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setDialogState(() => selectedWalletId = v),
                  ),
                ],
                const SizedBox(height: 10),
                TextField(
                  controller: noteCtrl,
                  decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)'),
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
                  final amt = double.tryParse(amountCtrl.text) ?? 0.0;
                  if (amt <= 0) return;
                  try {
                    await ApiClient().post(
                      ApiEndpoints.expensesAccrualsSettle,
                      data: {
                        'targetType': ex['target_type'],
                        'targetId': ex['id'],
                        'amount': amt,
                        'paymentMethod': paymentMethod,
                        if (paymentMethod == 'ELECTRONIC')
                          'walletId': selectedWalletId,
                        if (noteCtrl.text.trim().isNotEmpty)
                          'note': noteCtrl.text.trim(),
                      },
                    );
                    if (!mounted) return;
                    if (ctx.mounted) Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('تم سداد المصروف المستحق بنجاح ✅'),
                      ),
                    );
                    _fetchExpenses();
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          backgroundColor: AppColors.lossRed,
                          content: Text(formatUserError(e)),
                        ),
                      );
                    }
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

  void _showRecordAdvanceDialog() {
    final symbol = context.read<StoreSettingsProvider>().currencySymbol;
    final amountController = TextEditingController();
    final noteController = TextEditingController();
    String paymentMethod = 'CASH';
    String? selectedWalletId =
        _wallets.isNotEmpty ? _wallets.first['id']?.toString() : null;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text(
              'تسجيل سلفة شخصية (سلفتي)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: amountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: 'مبلغ السلفة ($symbol)'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: paymentMethod,
                  decoration: const InputDecoration(labelText: 'طريقة الصرف'),
                  items: const [
                    DropdownMenuItem(value: 'CASH', child: Text('نقداً من الدرج')),
                    DropdownMenuItem(
                      value: 'ELECTRONIC',
                      child: Text('محفظة إلكترونية'),
                    ),
                  ],
                  onChanged: (v) {
                    if (v != null) setDialogState(() => paymentMethod = v);
                  },
                ),
                if (paymentMethod == 'ELECTRONIC' && _wallets.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: selectedWalletId,
                    decoration: const InputDecoration(labelText: 'المحفظة'),
                    items: _wallets
                        .map(
                          (w) => DropdownMenuItem<String>(
                            value: w['id']?.toString(),
                            child: Text(w['name']?.toString() ?? 'محفظة'),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setDialogState(() => selectedWalletId = v),
                  ),
                ],
                const SizedBox(height: 10),
                TextField(
                  controller: noteController,
                  decoration: const InputDecoration(labelText: 'ملاحظة (اختياري)'),
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
                  final amt = double.tryParse(amountController.text) ?? 0.0;
                  if (amt <= 0) return;

                  Navigator.pop(ctx);
                  try {
                    final api = ApiClient();
                    await api.post(
                      ApiEndpoints.workerAdvances,
                      data: {
                        'amount': amt,
                        'paymentMethod': paymentMethod,
                        if (paymentMethod == 'ELECTRONIC')
                          'walletId': selectedWalletId,
                        'note': noteController.text.trim(),
                      },
                    );
                    _fetchExpenses();
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          backgroundColor: AppColors.lossRed,
                          content: Text(formatUserError(e)),
                        ),
                      );
                    }
                  }
                },
                child: const Text('تسجيل السلفة'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;
    final isOwner = auth.isOwner;
    final list = _filteredExpenses(isOwner);

    return AppScaffold(
      title: 'المصروفات والسلف',
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        onPressed: isOwner ? _showAddExpenseDialog : _showRecordAdvanceDialog,
        icon: const Icon(Icons.add),
        label: Text(isOwner ? 'مصروف جديد' : 'تسجيل سلفتي'),
      ),
      body: Column(
        children: [
          if (isOwner && _totalUnpaidAccruals > 0)
            Container(
              margin: const EdgeInsets.fromLTRB(14, 10, 14, 4),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.creditOrange.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.creditOrange.withOpacity(0.4)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'إجمالي المصروفات المستحقة بالآجل (2100):',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    '${_currencyFormat.format(_totalUnpaidAccruals)} $symbol',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: AppColors.lossRed,
                    ),
                  ),
                ],
              ),
            ),
          TabBar(
            controller: _tabController,
            isScrollable: isOwner,
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.textMuted,
            indicatorColor: AppColors.primary,
            tabs: isOwner
                ? const [
                    Tab(text: 'الكل'),
                    Tab(text: 'خدمات (5300)'),
                    Tab(text: 'أخرى (5700)'),
                    Tab(text: 'إيجارات (5200)'),
                    Tab(text: 'رواتب وسلف'),
                    Tab(text: 'مستحقات آجلة (2100)'),
                  ]
                : const [
                    Tab(text: 'سلفتي (سلف شخصية)'),
                  ],
          ),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : list.isEmpty
                    ? const Center(child: Text('لا توجد مصروفات مسجلة في هذا القسم'))
                    : RefreshIndicator(
                        onRefresh: _fetchExpenses,
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 80),
                          itemCount: list.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final ex = list[index];
                            final double amount =
                                (ex['amount'] as num?)?.toDouble() ?? 0.0;
                            final double remaining =
                                (ex['remaining_amount'] as num?)?.toDouble() ?? 0.0;
                            final desc =
                                (ex['note'] ?? ex['description'] ?? 'مصروف')
                                    .toString();
                            final catLabel =
                                (ex['category_label'] ?? ex['category'] ?? '')
                                    .toString();
                            final accCode = (ex['account_code'] ?? '').toString();
                            final method = (ex['payment_method'] ?? 'CASH').toString();
                            final methodAr = method == 'ELECTRONIC'
                                ? 'محفظة ${ex['wallet_name'] ?? ''}'
                                : method == 'CREDIT'
                                    ? 'آجل / مستحق'
                                    : 'نقداً';

                            return Card(
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 10,
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            desc,
                                            style: const TextStyle(
                                              fontWeight: FontWeight.bold,
                                              fontSize: 14,
                                            ),
                                          ),
                                        ),
                                        Text(
                                          '${_currencyFormat.format(amount)} $symbol',
                                          style: const TextStyle(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 14,
                                            color: AppColors.primary,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      [
                                        if (catLabel.isNotEmpty) catLabel,
                                        if (accCode.isNotEmpty) 'حساب $accCode',
                                        'الدفع: $methodAr',
                                      ].join(' · '),
                                      style: const TextStyle(
                                        fontSize: 11,
                                        color: AppColors.textSecondary,
                                      ),
                                    ),
                                    if (isOwner &&
                                        remaining > 0 &&
                                        ex['target_type'] != null) ...[
                                      const SizedBox(height: 6),
                                      Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.spaceBetween,
                                        children: [
                                          Text(
                                            'متبقي مستحق: ${_currencyFormat.format(remaining)} $symbol',
                                            style: const TextStyle(
                                              fontSize: 11,
                                              color: AppColors.lossRed,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                          OutlinedButton.icon(
                                            onPressed: () =>
                                                _showSettleAccrualDialog(ex),
                                            icon: const Icon(
                                              Icons.payments_outlined,
                                              size: 14,
                                            ),
                                            label: const Text(
                                              'سداد المستحق',
                                              style: TextStyle(fontSize: 11),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
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
