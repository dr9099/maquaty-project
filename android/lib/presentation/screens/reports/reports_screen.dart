import 'dart:io';
import 'package:csv/csv.dart';
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

class _ReportTabSpec {
  final String key;
  final String label;
  final String? directEndpoint;

  const _ReportTabSpec({
    required this.key,
    required this.label,
    this.directEndpoint,
  });
}

/// شاشة التقارير المالية وقائمة الدخل التفصيلية مع الفلترة بالتاريخ (اليوم / الأسبوع / الشهر / مخصص)
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  final _currencyFormat = NumberFormat('#,##0.##', 'ar');
  bool _isLoading = true;
  Map<String, dynamic>? _reportData;
  int _selectedIndex = 0;

  String _rangePreset = 'ALL'; // ALL | TODAY | WEEK | MONTH | CUSTOM
  DateTime? _dateFrom;
  DateTime? _dateTo;

  List<_ReportTabSpec> _tabsForAuth(AuthProvider auth) {
    if (auth.isOwner) {
      return const [
        _ReportTabSpec(
          key: 'profit_margin',
          label: 'قائمة الدخل والأرباح',
          directEndpoint: ApiEndpoints.reportsProfitMargin,
        ),
        _ReportTabSpec(key: 'sales', label: 'المبيعات'),
        _ReportTabSpec(key: 'purchases', label: 'المشتريات'),
        _ReportTabSpec(
          key: 'purchases_by_supplier',
          label: 'مشتريات الموردين',
          directEndpoint: ApiEndpoints.reportsPurchasesBySupplier,
        ),
        _ReportTabSpec(
          key: 'supplier_payables',
          label: 'ذمم الموردين',
          directEndpoint: ApiEndpoints.reportsSupplierPayables,
        ),
        _ReportTabSpec(key: 'expenses', label: 'المصاريف'),
        _ReportTabSpec(key: 'withdrawals', label: 'المسحوبات'),
      ];
    }

    if (auth.canManagePurchases) {
      // العامل المسؤول عند تفعيل صلاحيات المشتريات والموردين من المالك
      return const [
        _ReportTabSpec(key: 'sales', label: 'المبيعات'),
        _ReportTabSpec(key: 'purchases', label: 'المشتريات'),
        _ReportTabSpec(
          key: 'purchases_by_supplier',
          label: 'مشتريات الموردين',
          directEndpoint: ApiEndpoints.reportsPurchasesBySupplier,
        ),
        _ReportTabSpec(
          key: 'supplier_payables',
          label: 'ذمم الموردين',
          directEndpoint: ApiEndpoints.reportsSupplierPayables,
        ),
        _ReportTabSpec(key: 'expenses', label: 'المصاريف'),
        _ReportTabSpec(key: 'withdrawals', label: 'المسحوبات'),
      ];
    }

    // للعمال غير المصرح لهم بالمشتريات: حجب تام للمشتريات وتكلفة البضاعة وذمم الموردين
    return const [
      _ReportTabSpec(key: 'sales', label: 'المبيعات'),
      _ReportTabSpec(key: 'expenses', label: 'المصاريف'),
      _ReportTabSpec(key: 'withdrawals', label: 'المسحوبات'),
    ];
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _fetchReport());
  }

  String _fmtDateParam(DateTime d) {
    final y = d.year.toString().padLeft(4, '0');
    final m = d.month.toString().padLeft(2, '0');
    final day = d.day.toString().padLeft(2, '0');
    return '$y-$m-$day';
  }

  void _applyPreset(String preset) async {
    final now = DateTime.now();
    if (preset == 'CUSTOM') {
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
        _rangePreset = 'CUSTOM';
        _dateFrom = picked.start;
        _dateTo = picked.end;
      });
      _fetchReport();
      return;
    }

    setState(() {
      _rangePreset = preset;
      if (preset == 'TODAY') {
        _dateFrom = DateTime(now.year, now.month, now.day);
        _dateTo = DateTime(now.year, now.month, now.day);
      } else if (preset == 'WEEK') {
        _dateFrom = now.subtract(const Duration(days: 6));
        _dateTo = now;
      } else if (preset == 'MONTH') {
        _dateFrom = DateTime(now.year, now.month, 1);
        _dateTo = now;
      } else {
        _dateFrom = null;
        _dateTo = null;
      }
    });
    _fetchReport();
  }

  Future<void> _fetchReport() async {
    final auth = context.read<AuthProvider>();
    final tabs = _tabsForAuth(auth);
    final idx = _selectedIndex.clamp(0, tabs.length - 1);
    final tab = tabs[idx];

    final params = <String, dynamic>{
      if (tab.directEndpoint == null) 'type': tab.key,
      if (_dateFrom != null) 'date_from': _fmtDateParam(_dateFrom!),
      if (_dateTo != null) 'date_to': _fmtDateParam(_dateTo!),
    };

    setState(() => _isLoading = true);
    try {
      final api = ApiClient();
      final res = tab.directEndpoint != null
          ? await api.get(
              tab.directEndpoint!,
              queryParameters: params.isEmpty ? null : params,
            )
          : await api.get(ApiEndpoints.reports, queryParameters: params);
      if (!mounted) return;
      setState(() {
        _reportData =
            res.data is Map ? Map<String, dynamic>.from(res.data) : null;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _reportData = null;
        _isLoading = false;
      });
    }
  }

  double _extractHeadlineTotal(Map<String, dynamic>? d) {
    if (d == null) return 0.0;
    final candidates = [
      d['net_profit'],
      d['total_amount'],
      d['net_sales'],
      d['total_cost'],
      d['total_payables'],
      d['total_expenses'],
      d['total_withdrawals'],
    ];
    for (final c in candidates) {
      if (c is num) return c.toDouble();
    }
    return 0.0;
  }

  List<Map<String, dynamic>> _extractRecords(Map<String, dynamic>? d) {
    if (d == null) return [];
    final raw = d['records'] ?? d['items_breakdown'];
    if (raw is List) {
      return raw.map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return [];
  }

  String _recordTitle(Map<String, dynamic> r) {
    return (r['title'] ??
            r['name'] ??
            r['item_name'] ??
            r['supplier_name'] ??
            r['description'] ??
            r['recipient'] ??
            'بند تقرير')
        .toString();
  }

  String _recordSubtitle(Map<String, dynamic> r, String symbol) {
    if (r.containsKey('supplier_name') && r.containsKey('invoice_number')) {
      return 'فاتورة ${r['invoice_number']} · المورد: ${r['supplier_name']} · كمية: ${r['quantity']} ${r['unit'] ?? ""}';
    }
    if (r.containsKey('invoices_count') && r.containsKey('total_paid')) {
      return 'عدد الفواتير: ${r['invoices_count']} · مسدد: ${r['total_paid']} · متبقي: ${r['total_remaining']}';
    }
    if (r.containsKey('aging') && r['aging'] is Map) {
      final ag = Map<String, dynamic>.from(r['aging']);
      return '0-30ي: ${ag['days_0_30']} | 31-60ي: ${ag['days_31_60']} | +90ي: ${ag['days_90_plus']}';
    }
    if (r.containsKey('revenue') && r.containsKey('cogs')) {
      return 'مبيعات: ${r['revenue']} $symbol · تكلفة: ${r['cogs']} $symbol · هامش: ${r['margin_percent']}%';
    }
    if (r.containsKey('account_code')) {
      return 'حساب ${r['account_code']} · ${(r['paid_at'] ?? '').toString().split('T').first}';
    }
    return (r['date'] ??
            r['paid_at'] ??
            r['sold_at'] ??
            r['invoice_date'] ??
            '')
        .toString();
  }

  double _recordAmount(Map<String, dynamic> r) {
    final candidates = [
      r['amount'],
      r['total_purchase_cost'],
      r['net_purchases'],
      r['current_balance'],
      r['gross_profit'],
      r['total_cost'],
    ];
    for (final c in candidates) {
      if (c is num) return c.toDouble();
    }
    return 0.0;
  }

  Future<void> _exportCsv(String tabLabel, String symbol) async {
    final records = _extractRecords(_reportData);
    try {
      final rows = <List<dynamic>>[
        ['البند', 'التفاصيل', 'المبلغ ($symbol)'],
        ...records.map(
          (r) => [
            _recordTitle(r),
            _recordSubtitle(r, symbol),
            _recordAmount(r).toStringAsFixed(2),
          ],
        ),
      ];
      final csvStr = '\uFEFF${const ListToCsvConverter().convert(rows)}';
      final dir = await getTemporaryDirectory();
      final file = File(
        '${dir.path}/report_${DateTime.now().millisecondsSinceEpoch}.csv',
      );
      await file.writeAsString(csvStr);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('تم تصدير تقرير "$tabLabel" كملف Excel/CSV ✅'),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تجهيز التصدير بنجاح ✅')),
      );
    }
  }

  Future<void> _exportPdf(String tabLabel, String symbol) async {
    final records = _extractRecords(_reportData);
    final total = _extractHeadlineTotal(_reportData);
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
                'تقرير $tabLabel — نظام مَقوتي',
                style: const pw.TextStyle(fontSize: 16),
              ),
            ),
            pw.Text('الإجمالي: ${total.toStringAsFixed(2)} $symbol'),
            pw.SizedBox(height: 10),
            pw.TableHelper.fromTextArray(
              headers: ['المبلغ ($symbol)', 'التفاصيل', 'البند'],
              data: records
                  .map(
                    (r) => [
                      _recordAmount(r).toStringAsFixed(2),
                      _recordSubtitle(r, symbol),
                      _recordTitle(r),
                    ],
                  )
                  .toList(),
            ),
          ],
        ),
      );
      await Printing.layoutPdf(
        name: 'تقرير_$tabLabel.pdf',
        onLayout: (_) async => doc.save(),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تصدير التقرير كملف PDF ✅')),
      );
    }
  }

  Widget _buildIncomeStatementCard(Map<String, dynamic> d, String symbol) {
    final exp = d['expenses_breakdown'] is Map
        ? Map<String, dynamic>.from(d['expenses_breakdown'])
        : <String, dynamic>{};

    double numOf(dynamic v) => (v as num?)?.toDouble() ?? 0.0;

    final grossSales = numOf(d['gross_sales']);
    final salesReturns = numOf(d['sales_returns']);
    final netSales = numOf(d['net_sales']);
    final actualCogs = numOf(d['actual_cogs']);
    final grossProfit = numOf(d['gross_profit']);
    final damagedLoss = numOf(d['damaged_loss']);
    final salaries = numOf(exp['salaries']);
    final rent = numOf(exp['rent']);
    final utilities = numOf(exp['utilities']);
    final otherExp = numOf(exp['other_expenses']);
    final shortage = numOf(exp['cash_and_wallet_shortage']);
    final surplus = numOf(d['other_income_surplus']);
    final netProfit = numOf(d['net_profit']);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'قائمة الدخل التفصيلية للفترة',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                    color: AppColors.primary,
                  ),
                ),
                Text(
                  'الهامش الصافي: ${d['net_margin_percent'] ?? 0}%',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: AppColors.cashGreen,
                  ),
                ),
              ],
            ),
            const Divider(height: 16),
            _stmtLine('إجمالي المبيعات (4000)', grossSales, symbol),
            _stmtLine('(-) مردودات المبيعات (4100)', salesReturns, symbol, isNeg: true),
            _stmtLine('(=) صافي المبيعات', netSales, symbol, isSubtotal: true),
            _stmtLine(
              '(-) تكلفة البضاعة المباعة الفعلية (5000)',
              actualCogs,
              symbol,
              isNeg: true,
            ),
            _stmtLine(
              '(=) مجمل الربح (Gross Profit)',
              grossProfit,
              symbol,
              isSubtotal: true,
            ),
            const Divider(height: 14),
            _stmtLine('(-) خسائر البضاعة التالفة (5400)', damagedLoss, symbol, isNeg: true),
            _stmtLine('(-) الرواتب والأجور (5100)', salaries, symbol, isNeg: true),
            _stmtLine('(-) إيجار المتجر (5200)', rent, symbol, isNeg: true),
            _stmtLine(
              '(-) خدمات كهرباء ومياه وإنترنت (5300)',
              utilities,
              symbol,
              isNeg: true,
            ),
            _stmtLine(
              '(-) مصروفات أخرى للمتجر (مستقل - 5700)',
              otherExp,
              symbol,
              isNeg: true,
            ),
            if (shortage > 0)
              _stmtLine(
                '(-) عجز الصندوق وعمولات المحافظ (5600)',
                shortage,
                symbol,
                isNeg: true,
              ),
            if (surplus > 0)
              _stmtLine(
                '(+) إيرادات وفوائض مطابقة أخرى (4300)',
                surplus,
                symbol,
                isPos: true,
              ),
            const Divider(height: 16),
            _stmtLine(
              '(=) صافي الربح / الخسارة التشغيلي',
              netProfit,
              symbol,
              isFinal: true,
            ),
            const SizedBox(height: 6),
            const Text(
              '* إيداعات ومسحوبات المالك الشخصية (حساب 3100) تُسجل في حقوق الملكية ولا تُحتسب ضمن المصروفات أو الإيرادات التشغيلية.',
              style: TextStyle(fontSize: 10, color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stmtLine(
    String label,
    double val,
    String symbol, {
    bool isNeg = false,
    bool isPos = false,
    bool isSubtotal = false,
    bool isFinal = false,
  }) {
    Color color = AppColors.textPrimary;
    if (isFinal) {
      color = val < 0 ? AppColors.lossRed : AppColors.cashGreen;
    } else if (isSubtotal) {
      color = AppColors.primary;
    } else if (isNeg && val > 0) {
      color = AppColors.lossRed;
    } else if (isPos && val > 0) {
      color = AppColors.cashGreen;
    }

    return Padding(
      padding: EdgeInsets.symmetric(vertical: isSubtotal || isFinal ? 4 : 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: isFinal ? 13 : 12,
                fontWeight:
                    isSubtotal || isFinal ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
          Text(
            '${_currencyFormat.format(val)} $symbol',
            style: TextStyle(
              fontSize: isFinal ? 15 : 12,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final settings = context.watch<StoreSettingsProvider>();
    final tabs = _tabsForAuth(auth);
    final activeIdx = _selectedIndex.clamp(0, tabs.length - 1);
    final activeTab = tabs[activeIdx];
    final symbol =
        (_reportData?['currency_symbol'] ?? settings.currencySymbol).toString();

    final records = _extractRecords(_reportData);
    final count =
        (_reportData?['count'] ?? _reportData?['total'] ?? records.length)
            as int;
    final totalAmount = _extractHeadlineTotal(_reportData);

    return DefaultTabController(
      key: ValueKey('reports_tabs_${tabs.length}'),
      length: tabs.length,
      initialIndex: activeIdx,
      child: AppScaffold(
        title: 'التقارير والقوائم المالية',
        actions: [
          if (auth.isOwner)
            IconButton(
              tooltip: 'دفتر الأستاذ العام',
              icon: const Icon(Icons.menu_book_outlined),
              onPressed: () =>
                  Navigator.pushNamed(context, '/accounting/ledger'),
            ),
          IconButton(
            tooltip: 'تصدير PDF',
            icon: const Icon(Icons.picture_as_pdf_outlined),
            onPressed: () => _exportPdf(activeTab.label, symbol),
          ),
          IconButton(
            tooltip: 'تصدير Excel/CSV',
            icon: const Icon(Icons.table_chart_outlined),
            onPressed: () => _exportCsv(activeTab.label, symbol),
          ),
        ],
        body: Column(
          children: [
            TabBar(
              isScrollable: tabs.length > 3,
              labelColor: AppColors.primary,
              unselectedLabelColor: AppColors.textMuted,
              indicatorColor: AppColors.primary,
              onTap: (idx) {
                if (idx == _selectedIndex) return;
                setState(() => _selectedIndex = idx);
                _fetchReport();
              },
              tabs: tabs.map((t) => Tab(text: t.label)).toList(),
            ),

            // شريط الفلترة الزمنية للتقارير وقائمة الدخل
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 2),
              child: Row(
                children: [
                  _presetChip('ALL', 'كل الفترات'),
                  const SizedBox(width: 6),
                  _presetChip('TODAY', 'اليوم'),
                  const SizedBox(width: 6),
                  _presetChip('WEEK', 'آخر 7 أيام'),
                  const SizedBox(width: 6),
                  _presetChip('MONTH', 'هذا الشهر'),
                  const SizedBox(width: 6),
                  _presetChip(
                    'CUSTOM',
                    _rangePreset == 'CUSTOM' &&
                            _dateFrom != null &&
                            _dateTo != null
                        ? '${_fmtDateParam(_dateFrom!)} -> ${_fmtDateParam(_dateTo!)}'
                        : 'فترة مخصصة 📅',
                  ),
                ],
              ),
            ),

            // شريط إجمالي التقرير
            Container(
              margin: const EdgeInsets.fromLTRB(12, 8, 12, 8),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'عدد البنود: $count',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                  ),
                  Text(
                    '${activeTab.key == "profit_margin" ? "صافي الربح" : "الإجمالي"}: ${_currencyFormat.format(totalAmount)} $symbol',
                    style: const TextStyle(
                      color: AppColors.secondary,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),

            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : RefreshIndicator(
                      onRefresh: _fetchReport,
                      child: ListView(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 6,
                        ),
                        children: [
                          if (activeTab.key == 'profit_margin' &&
                              _reportData != null)
                            _buildIncomeStatementCard(_reportData!, symbol),
                          if (records.isEmpty)
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: 32),
                              child: Center(
                                child: Text(
                                  'لا توجد سجلات تفصيلية في هذه الفترة',
                                ),
                              ),
                            )
                          else
                            ...records.map((r) {
                              final amt = _recordAmount(r);
                              return Card(
                                margin: const EdgeInsets.only(bottom: 6),
                                child: ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor:
                                        AppColors.secondary.withOpacity(0.2),
                                    child: const Icon(
                                      Icons.analytics_outlined,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                  title: Text(
                                    _recordTitle(r),
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13,
                                    ),
                                  ),
                                  subtitle: Text(
                                    _recordSubtitle(r, symbol),
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: AppColors.textMuted,
                                    ),
                                  ),
                                  trailing: Text(
                                    '${_currencyFormat.format(amt)} $symbol',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                ),
                              );
                            }),
                        ],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _presetChip(String key, String label) {
    final selected = _rangePreset == key;
    return ChoiceChip(
      label: Text(label, style: const TextStyle(fontSize: 11)),
      selected: selected,
      visualDensity: VisualDensity.compact,
      selectedColor: AppColors.secondary.withOpacity(0.55),
      onSelected: (_) => _applyPreset(key),
    );
  }
}
