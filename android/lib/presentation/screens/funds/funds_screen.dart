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

/// شاشة موقف الأموال، جاري المالك (إيداع/سحب 3100)، وتسوية المحافظ الإلكترونية
class FundsScreen extends StatefulWidget {
  const FundsScreen({super.key});

  @override
  State<FundsScreen> createState() => _FundsScreenState();
}

class _FundsScreenState extends State<FundsScreen> {
  final _currencyFormat = NumberFormat('#,##0.##', 'ar');
  bool _isLoading = true;
  Map<String, dynamic>? _fundsData;
  List<Map<String, dynamic>> _wallets = [];
  List<Map<String, dynamic>> _ownerTxs = [];

  @override
  void initState() {
    super.initState();
    _fetchAll();
  }

  Future<void> _fetchAll() async {
    setState(() => _isLoading = true);
    final api = ApiClient();
    final isOwner = context.read<AuthProvider>().isOwner;

    try {
      final res = await api.get(ApiEndpoints.fundsSummary);
      Map<String, dynamic>? fundsMap =
          res.data is Map ? Map<String, dynamic>.from(res.data) : null;

      List<Map<String, dynamic>> walletsList = [];
      try {
        final wRes = await api.get(ApiEndpoints.wallets);
        if (wRes.data is List) {
          walletsList = (wRes.data as List)
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        }
      } catch (_) {}

      List<Map<String, dynamic>> ownerList = [];
      if (isOwner) {
        try {
          final oRes = await api.get(ApiEndpoints.ownerTransactions);
          if (oRes.data is Map && oRes.data['records'] is List) {
            ownerList = (oRes.data['records'] as List)
                .map((e) => Map<String, dynamic>.from(e))
                .toList();
          }
        } catch (_) {}
      }

      if (!mounted) return;
      setState(() {
        _fundsData = fundsMap;
        _wallets = walletsList;
        _ownerTxs = ownerList;
        _isLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showOwnerTransactionDialog(String txType) {
    final isDeposit = txType == 'DEPOSIT';
    final symbol = context.read<StoreSettingsProvider>().currencySymbol;
    final amountCtrl = TextEditingController();
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
            title: Text(
              isDeposit
                  ? 'إيداع مالك للمحل (حساب 3100)'
                  : 'سحب مالك من المحل (حساب 3100)',
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isDeposit
                        ? 'يُضاف المبلغ إلى سيولة المحل ويُسجل في حقوق الملكية (جاري المالك 3100) دون اعتباره مبيعات.'
                        : 'يُخصم المبلغ من سيولة المحل ويُسجل في حقوق الملكية (جاري المالك 3100) دون اعتباره مصروفاً تشغيلياً.',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: amountCtrl,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(labelText: 'المبلغ ($symbol) *'),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: paymentMethod,
                    decoration: const InputDecoration(labelText: 'وعاء الحركة *'),
                    items: const [
                      DropdownMenuItem(
                        value: 'CASH',
                        child: Text('الصندوق النقدي (حساب 1000)'),
                      ),
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
                      decoration: const InputDecoration(labelText: 'اختر المحفظة *'),
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
                    decoration: const InputDecoration(labelText: 'البيان / الملاحظة'),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('إلغاء'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: isDeposit ? AppColors.cashGreen : AppColors.lossRed,
                ),
                onPressed: () async {
                  final amt = double.tryParse(amountCtrl.text) ?? 0.0;
                  if (amt <= 0) return;
                  try {
                    await ApiClient().post(
                      ApiEndpoints.ownerTransactions,
                      data: {
                        'type': txType,
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
                      SnackBar(
                        content: Text(
                          isDeposit
                              ? 'تم تسجيل إيداع المالك بنجاح ✅'
                              : 'تم تسجيل مسحوبات المالك بنجاح ✅',
                        ),
                      ),
                    );
                    _fetchAll();
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
                child: Text(isDeposit ? 'تأكيد الإيداع' : 'تأكيد السحب'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showCreateWalletDialog() {
    final nameCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text(
            'إضافة محفظة إلكترونية جديدة',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          ),
          content: TextField(
            controller: nameCtrl,
            decoration: const InputDecoration(
              labelText: 'اسم المحفظة * (مثال: جوالي، كريمي، ون كاش)',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: () async {
                final name = nameCtrl.text.trim();
                if (name.isEmpty) return;
                try {
                  await ApiClient().post(ApiEndpoints.wallets, data: {'name': name});
                  if (!mounted) return;
                  if (ctx.mounted) Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('تم إنشاء المحفظة وحسابها المحاسبي ✅')),
                  );
                  _fetchAll();
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
              child: const Text('إضافة'),
            ),
          ],
        ),
      ),
    );
  }

  void _showSettleWalletDialog(Map<String, dynamic> wallet, String symbol) {
    final bookBalance =
        ((wallet['book_balance'] ?? wallet['balance']) as num?)?.toDouble() ?? 0.0;
    final actualCtrl =
        TextEditingController(text: bookBalance.toStringAsFixed(0));
    final cashOutCtrl = TextEditingController(text: '0');
    final notesCtrl = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          final actual = double.tryParse(actualCtrl.text) ?? bookBalance;
          final diff = actual - bookBalance;

          return Directionality(
            textDirection: TextDirection.rtl,
            child: AlertDialog(
              title: Text(
                'تسوية ومطابقة محفظة: ${wallet['name']}',
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceMuted,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'الرصيد الدفتري بالنظام: ${_currencyFormat.format(bookBalance)} $symbol',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                          Text(
                            'عمليات غير مسواة: ${wallet['unsettled_count'] ?? 0}',
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.textSecondary,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'الفرق (الفعلي - الدفتري): ${_currencyFormat.format(diff)} $symbol '
                            '${diff < 0 ? "(عمولة/عجز -> حساب 5600)" : diff > 0 ? "(فائض -> حساب 4300)" : "(متطابق ✅)"}',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: diff < 0
                                  ? AppColors.lossRed
                                  : AppColors.cashGreen,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: actualCtrl,
                      onChanged: (_) => setDialogState(() {}),
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText: 'الرصيد الفعلي لدى المزود الآن ($symbol) *',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: cashOutCtrl,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText:
                            'مبلغ مسحوب نقداً من المحفظة للصندوق ($symbol - اختياري)',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: notesCtrl,
                      decoration: const InputDecoration(
                        labelText: 'ملاحظات التسوية / مرجع المزود',
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('إلغاء'),
                ),
                ElevatedButton(
                  onPressed: () async {
                    final actualVal = double.tryParse(actualCtrl.text);
                    final cashOutVal = double.tryParse(cashOutCtrl.text) ?? 0.0;
                    if (actualVal == null || actualVal < 0) return;

                    try {
                      await ApiClient().post(
                        ApiEndpoints.walletSettle(wallet['id'].toString()),
                        data: {
                          'actualProviderBalance': actualVal,
                          if (cashOutVal > 0) 'cashOutToDrawer': cashOutVal,
                          if (notesCtrl.text.trim().isNotEmpty)
                            'notes': notesCtrl.text.trim(),
                        },
                      );
                      if (!mounted) return;
                      if (ctx.mounted) Navigator.pop(ctx);
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('تمت تسوية المحفظة وترحيل القيود بنجاح ✅'),
                        ),
                      );
                      _fetchAll();
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
                  child: const Text('اعتماد التسوية'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _showWalletTransactionsSheet(
    Map<String, dynamic> wallet,
    String symbol,
  ) async {
    try {
      final res = await ApiClient().get(
        ApiEndpoints.walletTransactions(wallet['id'].toString()),
      );
      if (!mounted) return;
      final map = res.data is Map
          ? Map<String, dynamic>.from(res.data)
          : <String, dynamic>{};
      final txs = map['transactions'] is List
          ? (map['transactions'] as List)
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];

      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        builder: (ctx) => Directionality(
          textDirection: TextDirection.rtl,
          child: DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.65,
            builder: (_, ctrl) => Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'حركات محفظة: ${wallet['name']} (كود ${wallet['account_code'] ?? "1100"})',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primary,
                    ),
                  ),
                  const Divider(height: 18),
                  Expanded(
                    child: txs.isEmpty
                        ? const Center(child: Text('لا توجد حركات مسجلة بعد.'))
                        : ListView.separated(
                            controller: ctrl,
                            itemCount: txs.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 6),
                            itemBuilder: (_, idx) {
                              final t = txs[idx];
                              final dir = (t['direction'] ?? 'IN').toString();
                              final isIn = dir == 'IN';
                              final settled = t['settled'] == true;
                              final amt =
                                  (t['amount'] as num?)?.toDouble() ?? 0.0;
                              return Card(
                                child: ListTile(
                                  dense: true,
                                  title: Text(
                                    (t['description'] ?? t['type'] ?? 'حركة')
                                        .toString(),
                                    style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  subtitle: Text(
                                    settled ? 'مسواة ✅' : 'غير مسواة ⏳',
                                    style: TextStyle(
                                      fontSize: 11,
                                      color: settled
                                          ? AppColors.cashGreen
                                          : AppColors.creditOrange,
                                    ),
                                  ),
                                  trailing: Text(
                                    '${isIn ? "+" : "-"}${_currencyFormat.format(amt)} $symbol',
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: isIn
                                          ? AppColors.cashGreen
                                          : AppColors.lossRed,
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final settings = context.watch<StoreSettingsProvider>();
    final symbol =
        (_fundsData?['currency_symbol'] ?? settings.currencySymbol).toString();

    final double safeCash =
        ((_fundsData?['cash_in_hand'] ?? _fundsData?['safe_cash']) as num?)
                ?.toDouble() ??
            0.0;
    final double electronic = ((_fundsData?['wallets_balance'] ??
                _fundsData?['electronic_wallets']) as num?)
            ?.toDouble() ??
        0.0;
    final double receivables = ((_fundsData?['customer_receivables'] ??
                _fundsData?['receivables']) as num?)
            ?.toDouble() ??
        0.0;
    final double totalFunds =
        (_fundsData?['total_funds'] as num?)?.toDouble() ?? 0.0;
    final double? supplierPayables =
        (_fundsData?['supplier_payables'] as num?)?.toDouble();
    final double? accruedExpenses =
        ((_fundsData?['accrued_expenses_payable'] ?? _fundsData?['accrued_expenses']) as num?)
            ?.toDouble();
    final double? ownerEquityNet =
        (_fundsData?['owner_equity_net'] as num?)?.toDouble();
    final double? netAfterPayables =
        (_fundsData?['net_funds_after_payables'] as num?)?.toDouble();

    return AppScaffold(
      title: 'موقف الأموال والصندوق',
      currentBottomNavIndex: 4,
      actions: [
        if (auth.isOwner)
          IconButton(
            tooltip: 'دفتر الأستاذ العام',
            icon: const Icon(Icons.menu_book_outlined),
            onPressed: () => Navigator.pushNamed(context, '/accounting/ledger'),
          ),
      ],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _fetchAll,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // بطاقة إجمالي الأموال الكلي
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [AppColors.primaryDark, AppColors.primary],
                        begin: Alignment.topRight,
                        end: Alignment.bottomLeft,
                      ),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'إجمالي الأموال والسيولة المتاحة',
                          style: TextStyle(
                            color: AppColors.surfaceMuted,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${_currencyFormat.format(totalFunds)} $symbol',
                          style: const TextStyle(
                            color: AppColors.secondary,
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (auth.canManagePurchases &&
                            netAfterPayables != null) ...[
                          const SizedBox(height: 6),
                          Text(
                            'الصافي بعد خصم ذمم الموردين والمستحقات: ${_currencyFormat.format(netAfterPayables)} $symbol',
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),

                  // أزرار إيداع وسحب المالك (حصري لمالك المتجر - جاري المالك 3100)
                  if (auth.isOwner) ...[
                    Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.cashGreen,
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            onPressed: () =>
                                _showOwnerTransactionDialog('DEPOSIT'),
                            icon: const Icon(Icons.add_circle_outline, size: 18),
                            label: const Text(
                              'إيداع مالك (+)',
                              style: TextStyle(fontSize: 13),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.lossRed,
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            onPressed: () =>
                                _showOwnerTransactionDialog('WITHDRAWAL'),
                            icon: const Icon(
                              Icons.remove_circle_outline,
                              size: 18,
                            ),
                            label: const Text(
                              'سحب مالك (-)',
                              style: TextStyle(fontSize: 13),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                  ],

                  // تفصيل أرصدة الحسابات
                  _fundItem(
                    title: 'الصندوق الدفتري (حساب 1000)',
                    amount: safeCash,
                    symbol: symbol,
                    icon: Icons.payments_outlined,
                    color: AppColors.cashGreen,
                  ),
                  const SizedBox(height: 8),

                  _fundItem(
                    title: 'المحافظ الإلكترونية الدفترية (حساب 1100)',
                    amount: electronic,
                    symbol: symbol,
                    icon: Icons.account_balance_wallet_outlined,
                    color: AppColors.electronicBlue,
                  ),
                  const SizedBox(height: 8),

                  _fundItem(
                    title: 'ذمم العملاء المدينة (حساب 1200)',
                    amount: receivables,
                    symbol: symbol,
                    icon: Icons.credit_card_outlined,
                    color: AppColors.creditOrange,
                  ),

                  if (auth.canManagePurchases && supplierPayables != null) ...[
                    const SizedBox(height: 8),
                    _fundItem(
                      title: 'ذمم الموردين الدائنة المستحقة (حساب 2000)',
                      amount: supplierPayables,
                      symbol: symbol,
                      icon: Icons.local_shipping_outlined,
                      color: AppColors.lossRed,
                    ),
                  ],

                  if (auth.isOwner && accruedExpenses != null) ...[
                    const SizedBox(height: 8),
                    _fundItem(
                      title: 'المصروفات المستحقة غير المسددة (حساب 2100)',
                      amount: accruedExpenses,
                      symbol: symbol,
                      icon: Icons.receipt_long_outlined,
                      color: AppColors.creditOrange,
                    ),
                  ],

                  if (auth.isOwner && ownerEquityNet != null) ...[
                    const SizedBox(height: 8),
                    _fundItem(
                      title: 'صافي جاري المالك — إيداعات ناقص مسحوبات (3100)',
                      amount: ownerEquityNet,
                      symbol: symbol,
                      icon: Icons.account_balance_outlined,
                      color: AppColors.primary,
                    ),
                  ],

                  // قسم إدارة وتسوية المحافظ الإلكترونية للمالك
                  if (auth.isOwner) ...[
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'المحافظ الإلكترونية والتسوية مع المزود',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: AppColors.primary,
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _showCreateWalletDialog,
                          icon: const Icon(Icons.add, size: 16),
                          label: const Text(
                            'محفظة جديدة',
                            style: TextStyle(fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                    if (_wallets.isEmpty)
                      const Card(
                        child: Padding(
                          padding: EdgeInsets.all(14),
                          child: Text(
                            'لا توجد محافظ مسجلة حالياً — اضغط "محفظة جديدة" لإضافة محفظة.',
                            style: TextStyle(
                              fontSize: 12,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ),
                      ),
                    ..._wallets.map((w) {
                      final bookBal =
                          ((w['book_balance'] ?? w['balance']) as num?)
                                  ?.toDouble() ??
                              0.0;
                      final unsettledCount =
                          (w['unsettled_count'] as num?)?.toInt() ?? 0;
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    '${w['name']} (${w['account_code'] ?? "1100"})',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14,
                                    ),
                                  ),
                                  Text(
                                    '${_currencyFormat.format(bookBal)} $symbol',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 15,
                                      color: AppColors.electronicBlue,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                unsettledCount > 0
                                    ? 'عمليات إلكترونية بانتظار التسوية: $unsettledCount'
                                    : 'جميع عمليات المحفظة مسواة ✅',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: unsettledCount > 0
                                      ? AppColors.creditOrange
                                      : AppColors.cashGreen,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  TextButton.icon(
                                    onPressed: () =>
                                        _showWalletTransactionsSheet(w, symbol),
                                    icon: const Icon(Icons.list_alt, size: 16),
                                    label: const Text(
                                      'حركات المحفظة',
                                      style: TextStyle(fontSize: 12),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  OutlinedButton.icon(
                                    onPressed: () =>
                                        _showSettleWalletDialog(w, symbol),
                                    icon: const Icon(
                                      Icons.fact_check_outlined,
                                      size: 16,
                                    ),
                                    label: const Text(
                                      'تسوية ومطابقة',
                                      style: TextStyle(fontSize: 12),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    }),

                    if (_ownerTxs.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      const Text(
                        'آخر حركات جاري المالك (حساب 3100)',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary,
                        ),
                      ),
                      const SizedBox(height: 6),
                      ..._ownerTxs.take(5).map((tx) {
                        final isDep = tx['type'] == 'DEPOSIT';
                        final amt = (tx['amount'] as num?)?.toDouble() ?? 0.0;
                        return Card(
                          child: ListTile(
                            dense: true,
                            leading: Icon(
                              isDep ? Icons.south_west : Icons.north_east,
                              color: isDep
                                  ? AppColors.cashGreen
                                  : AppColors.lossRed,
                            ),
                            title: Text(
                              isDep ? 'إيداع مالك للمحل' : 'سحب مالك من المحل',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 12,
                              ),
                            ),
                            subtitle: Text(
                              (tx['note'] ?? tx['payment_method'] ?? '')
                                  .toString(),
                              style: const TextStyle(fontSize: 11),
                            ),
                            trailing: Text(
                              '${isDep ? "+" : "-"}${_currencyFormat.format(amt)} $symbol',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: isDep
                                    ? AppColors.cashGreen
                                    : AppColors.lossRed,
                              ),
                            ),
                          ),
                        );
                      }),
                    ],

                    const SizedBox(height: 16),
                    OutlinedButton.icon(
                      onPressed: () =>
                          Navigator.pushNamed(context, '/accounting/ledger'),
                      icon: const Icon(Icons.menu_book_outlined),
                      label: const Text(
                        'مراجعة دفتر الأستاذ العام وميزان المراجعة',
                      ),
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _fundItem({
    required String title,
    required double amount,
    required String symbol,
    required IconData icon,
    required Color color,
  }) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withOpacity(0.15),
          child: Icon(icon, color: color),
        ),
        title: Text(
          title,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
        ),
        trailing: Text(
          '${_currencyFormat.format(amount)} $symbol',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
      ),
    );
  }
}
