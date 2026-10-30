import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة مراجعة دفتر الأستاذ العام وميزان المراجعة (قراءة فقط Append-only — حصري لمالك المتجر)
class GeneralLedgerScreen extends StatefulWidget {
  const GeneralLedgerScreen({super.key});

  @override
  State<GeneralLedgerScreen> createState() => _GeneralLedgerScreenState();
}

class _GeneralLedgerScreenState extends State<GeneralLedgerScreen> {
  final _numFormat = NumberFormat('#,##0.##', 'ar');

  bool _isLoading = true;
  List<Map<String, dynamic>> _accounts = [];
  Map<String, dynamic>? _trialBalance;
  List<Map<String, dynamic>> _entries = [];
  Map<String, dynamic>? _ledgerSummary;
  Map<String, dynamic>? _selectedAccountMeta;

  String? _selectedAccountCode; // null = جميع الحسابات
  String? _selectedRefType;
  DateTime? _dateFrom;
  DateTime? _dateTo;

  static const List<MapEntry<String, String>> _refTypeOptions = [
    MapEntry('', 'كل أنواع العمليات'),
    MapEntry('SALE', 'مبيعات'),
    MapEntry('RETURN', 'مرتجع مبيعات'),
    MapEntry('CREDIT_PAYMENT', 'تحصيل دين عميل'),
    MapEntry('PURCHASE', 'فاتورة مشتريات'),
    MapEntry('PURCHASE_PAYMENT', 'سداد مورد'),
    MapEntry('PURCHASE_RETURN', 'مرتجع مشتريات'),
    MapEntry('EXPENSE', 'مصروفات وسلف'),
    MapEntry('EXPENSE_SETTLEMENT', 'سداد مصروف مستحق'),
    MapEntry('DAMAGED_GOODS', 'إتلاف بضاعة'),
    MapEntry('OWNER_DEPOSIT', 'إيداع مالك'),
    MapEntry('OWNER_WITHDRAWAL', 'سحب مالك'),
    MapEntry('WALLET_SETTLEMENT', 'تسوية محفظة إلكترونية'),
    MapEntry('CLOSING', 'إقفال ومطابقة يومية'),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadData());
  }

  String _fmtDate(DateTime d) {
    final y = d.year.toString().padLeft(4, '0');
    final m = d.month.toString().padLeft(2, '0');
    final day = d.day.toString().padLeft(2, '0');
    return '$y-$m-$day';
  }

  Future<void> _loadData() async {
    if (!context.read<AuthProvider>().isOwner) return;
    setState(() => _isLoading = true);

    try {
      final api = ApiClient();
      final dateParams = <String, dynamic>{
        if (_dateFrom != null) 'from': _fmtDate(_dateFrom!),
        if (_dateTo != null) 'to': _fmtDate(_dateTo!),
      };

      final accRes = await api.get(
        ApiEndpoints.accountingAccounts,
        queryParameters: dateParams.isEmpty ? null : dateParams,
      );

      final ledgerRes = await api.get(
        ApiEndpoints.accountingLedger,
        queryParameters: {
          ...dateParams,
          if (_selectedAccountCode != null && _selectedAccountCode!.isNotEmpty)
            'account_code': _selectedAccountCode,
          if (_selectedRefType != null && _selectedRefType!.isNotEmpty)
            'reference_type': _selectedRefType,
          'limit': 250,
        },
      );

      if (!mounted) return;
      final accMap = accRes.data is Map
          ? Map<String, dynamic>.from(accRes.data)
          : <String, dynamic>{};
      final ledMap = ledgerRes.data is Map
          ? Map<String, dynamic>.from(ledgerRes.data)
          : <String, dynamic>{};

      setState(() {
        _trialBalance = accMap['trial_balance'] is Map
            ? Map<String, dynamic>.from(accMap['trial_balance'])
            : null;
        _accounts = accMap['accounts'] is List
            ? (accMap['accounts'] as List)
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _entries = ledMap['entries'] is List
            ? (ledMap['entries'] as List)
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        _ledgerSummary = ledMap['summary'] is Map
            ? Map<String, dynamic>.from(ledMap['summary'])
            : null;
        _selectedAccountMeta = ledMap['account'] is Map
            ? Map<String, dynamic>.from(ledMap['account'])
            : null;
        _isLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _pickDateRange() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2024, 1, 1),
      lastDate: DateTime(now.year + 2, 12, 31),
      initialDateRange: _dateFrom != null && _dateTo != null
          ? DateTimeRange(start: _dateFrom!, end: _dateTo!)
          : DateTimeRange(
              start: now.subtract(const Duration(days: 7)),
              end: now,
            ),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _dateFrom = picked.start;
      _dateTo = picked.end;
    });
    _loadData();
  }

  Future<void> _exportCsv() async {
    try {
      final res = await ApiClient().get(
        ApiEndpoints.accountingLedger,
        queryParameters: {
          if (_dateFrom != null) 'from': _fmtDate(_dateFrom!),
          if (_dateTo != null) 'to': _fmtDate(_dateTo!),
          if (_selectedAccountCode != null && _selectedAccountCode!.isNotEmpty)
            'account_code': _selectedAccountCode,
          if (_selectedRefType != null && _selectedRefType!.isNotEmpty)
            'reference_type': _selectedRefType,
          'format': 'csv',
        },
      );
      final csv = (res.data is Map ? res.data['csv_content'] : null)?.toString();
      if (csv != null && csv.isNotEmpty) {
        final dir = await getTemporaryDirectory();
        final f = File(
          '${dir.path}/general_ledger_${DateTime.now().millisecondsSinceEpoch}.csv',
        );
        await f.writeAsString(csv);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تم تصدير قيود دفتر الأستاذ كملف Excel/CSV ✅'),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تجهيز تصدير دفتر الأستاذ ✅')),
      );
    }
  }

  Future<void> _exportPdf(String symbol) async {
    try {
      final fontData = await rootBundle.load('assets/fonts/Titr.ttf');
      final font = pw.Font.ttf(fontData);
      final doc = pw.Document();
      doc.addPage(
        pw.MultiPage(
          pageFormat: PdfPageFormat.a4,
          textDirection: pw.TextDirection.rtl,
          theme: pw.ThemeData.withFont(base: font, bold: font),
          build: (_) => [
            pw.Header(
              level: 0,
              child: pw.Text(
                'دفتر الأستاذ العام — نظام مَقوتي',
                style: const pw.TextStyle(fontSize: 16),
              ),
            ),
            pw.TableHelper.fromTextArray(
              headers: ['دائن', 'مدين', 'البيان', 'الحساب', 'التاريخ'],
              data: _entries
                  .map(
                    (e) => [
                      ((e['credit'] as num?) ?? 0).toStringAsFixed(2),
                      ((e['debit'] as num?) ?? 0).toStringAsFixed(2),
                      (e['description'] ?? '').toString(),
                      '${e['account_code']} - ${e['account_name']}',
                      (e['entry_date'] ?? '').toString().split('T').first,
                    ],
                  )
                  .toList(),
            ),
          ],
        ),
      );
      await Printing.layoutPdf(
        name: 'دفتر_الأستاذ_العام.pdf',
        onLayout: (_) async => doc.save(),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تصدير دفتر الأستاذ كملف PDF ✅')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final symbol = context.watch<StoreSettingsProvider>().currencySymbol;

    if (!auth.isOwner) {
      return const AppScaffold(
        title: 'دفتر الأستاذ العام',
        body: Center(
          child: Text('هذه الشاشة مخصصة لمالك المتجر فقط.'),
        ),
      );
    }

    final totalDebit =
        (_trialBalance?['total_debit'] as num?)?.toDouble() ?? 0.0;
    final totalCredit =
        (_trialBalance?['total_credit'] as num?)?.toDouble() ?? 0.0;
    final isBalanced = _trialBalance?['is_balanced'] != false;

    return AppScaffold(
      title: 'دفتر الأستاذ العام وميزان المراجعة',
      actions: [
        IconButton(
          tooltip: 'تصدير PDF',
          icon: const Icon(Icons.picture_as_pdf_outlined),
          onPressed: () => _exportPdf(symbol),
        ),
        IconButton(
          tooltip: 'تصدير CSV',
          icon: const Icon(Icons.table_chart_outlined),
          onPressed: _exportCsv,
        ),
      ],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadData,
              child: ListView(
                padding: const EdgeInsets.all(14),
                children: [
                  // شريط ميزان المراجعة وتوازن القيد المزدوج
                  Container(
                    padding: const EdgeInsets.all(14),
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
                            const Text(
                              'ميزان المراجعة (Append-Only Double Entry)',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                isBalanced ? 'متوازن ✅' : 'فرق غير متوازن ⚠️',
                                style: const TextStyle(
                                  color: AppColors.secondary,
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'إجمالي المدين: ${_numFormat.format(totalDebit)} $symbol',
                              style: const TextStyle(
                                color: AppColors.secondary,
                                fontWeight: FontWeight.bold,
                                fontSize: 12,
                              ),
                            ),
                            Text(
                              'إجمالي الدائن: ${_numFormat.format(totalCredit)} $symbol',
                              style: const TextStyle(
                                color: AppColors.secondary,
                                fontWeight: FontWeight.bold,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),

                  // فلاتر الحساب ونوع الحركة والتاريخ
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          DropdownButtonFormField<String>(
                            value: _selectedAccountCode ?? '',
                            decoration: const InputDecoration(
                              labelText: 'تصفية حسب الحساب المحاسبي',
                              isDense: true,
                            ),
                            items: [
                              const DropdownMenuItem(
                                value: '',
                                child: Text('جميع الحسابات (اليومية العامة)'),
                              ),
                              ..._accounts.map(
                                (a) => DropdownMenuItem<String>(
                                  value: a['code']?.toString() ?? '',
                                  child: Text(
                                    '${a['code']} — ${a['name']} (${_numFormat.format((a['net_balance'] as num?) ?? 0)} $symbol)',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                            ],
                            onChanged: (v) {
                              setState(() {
                                _selectedAccountCode =
                                    (v == null || v.isEmpty) ? null : v;
                              });
                              _loadData();
                            },
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: DropdownButtonFormField<String>(
                                  value: _selectedRefType ?? '',
                                  decoration: const InputDecoration(
                                    labelText: 'نوع الحركة',
                                    isDense: true,
                                  ),
                                  items: _refTypeOptions
                                      .map(
                                        (opt) => DropdownMenuItem(
                                          value: opt.key,
                                          child: Text(
                                            opt.value,
                                            style: const TextStyle(fontSize: 12),
                                          ),
                                        ),
                                      )
                                      .toList(),
                                  onChanged: (v) {
                                    setState(() {
                                      _selectedRefType =
                                          (v == null || v.isEmpty) ? null : v;
                                    });
                                    _loadData();
                                  },
                                ),
                              ),
                              const SizedBox(width: 8),
                              OutlinedButton.icon(
                                onPressed: _pickDateRange,
                                icon: const Icon(Icons.date_range, size: 16),
                                label: Text(
                                  _dateFrom != null && _dateTo != null
                                      ? '${_fmtDate(_dateFrom!)}\n${_fmtDate(_dateTo!)}'
                                      : 'الفترة',
                                  style: const TextStyle(fontSize: 11),
                                ),
                              ),
                              if (_dateFrom != null)
                                IconButton(
                                  tooltip: 'مسح التاريخ',
                                  icon: const Icon(Icons.clear, size: 18),
                                  onPressed: () {
                                    setState(() {
                                      _dateFrom = null;
                                      _dateTo = null;
                                    });
                                    _loadData();
                                  },
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),

                  if (_selectedAccountMeta != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.secondary.withOpacity(0.18),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'رصيد أول الفترة: ${_numFormat.format((_selectedAccountMeta!['opening_balance'] as num?) ?? 0)} $symbol',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Text(
                            'الرصيد الختامي: ${_numFormat.format((_selectedAccountMeta!['closing_balance'] as num?) ?? 0)} $symbol',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: AppColors.primary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 12),
                  Text(
                    'سجل القيود (${_ledgerSummary?['total_entries'] ?? _entries.length})',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(height: 6),

                  if (_entries.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 32),
                      child: Center(
                        child: Text('لا توجد قيود مطابقة للفلتر الحالي.'),
                      ),
                    )
                  else
                    ..._entries.map((e) {
                      final debit = (e['debit'] as num?)?.toDouble() ?? 0.0;
                      final credit = (e['credit'] as num?)?.toDouble() ?? 0.0;
                      final running =
                          (e['running_balance'] as num?)?.toDouble();
                      final dateStr =
                          (e['entry_date'] ?? '').toString().split('T').first;

                      return Card(
                        margin: const EdgeInsets.only(bottom: 6),
                        child: Padding(
                          padding: const EdgeInsets.all(10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    child: Text(
                                      '${e['account_code']} — ${e['account_name']}',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 13,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                  ),
                                  Text(
                                    dateStr,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: AppColors.textMuted,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '${e['reference_type_label'] ?? e['reference_type']} · ${e['description'] ?? ""}',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'مدين: ${_numFormat.format(debit)} $symbol',
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold,
                                      color: debit > 0
                                          ? AppColors.cashGreen
                                          : AppColors.textMuted,
                                    ),
                                  ),
                                  Text(
                                    'دائن: ${_numFormat.format(credit)} $symbol',
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold,
                                      color: credit > 0
                                          ? AppColors.lossRed
                                          : AppColors.textMuted,
                                    ),
                                  ),
                                  if (running != null)
                                    Text(
                                      'الرصيد: ${_numFormat.format(running)}',
                                      style: const TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                ],
              ),
            ),
    );
  }
}

