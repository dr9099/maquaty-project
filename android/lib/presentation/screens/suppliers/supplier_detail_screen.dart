import 'dart:io';
import 'package:csv/csv.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/error_formatter.dart';
import '../../providers/auth_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../providers/suppliers_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة ملف المورد وكشف الحساب التراكمي وأعمار الديون وسداد الدفعات والتصدير (PDF / CSV)
class SupplierDetailScreen extends StatefulWidget {
  final SupplierModel supplier;

  const SupplierDetailScreen({super.key, required this.supplier});

  @override
  State<SupplierDetailScreen> createState() => _SupplierDetailScreenState();
}

class _SupplierDetailScreenState extends State<SupplierDetailScreen> {
  final _numFormat = NumberFormat('#,##0.##', 'ar');
  bool _loading = true;
  SupplierStatementData? _statement;
  SupplierAgingData? _aging;
  List<Map<String, dynamic>> _wallets = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    final prov = context.read<SuppliersProvider>();
    final stmt = await prov.fetchStatement(widget.supplier.id);
    final aging = await prov.fetchAging(widget.supplier.id);
    try {
      final res = await ApiClient().get(ApiEndpoints.wallets);
      if (res.data is List) {
        _wallets = (res.data as List)
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _statement = stmt;
      _aging = aging;
      _loading = false;
    });
  }

  Future<void> _exportCsv() async {
    final stmt = _statement;
    if (stmt == null) return;
    try {
      final rows = <List<dynamic>>[
        [
          'التاريخ',
          'المرجع',
          'البيان',
          'مدين (سداد/مرتجع)',
          'دائن (مشتريات)',
          'الرصيد التراكمي (${stmt.currencySymbol})',
        ],
        ...stmt.transactions.map((t) => [
              t.date.length >= 10 ? t.date.substring(0, 10) : t.date,
              t.reference,
              t.description,
              t.debit.toStringAsFixed(2),
              t.credit.toStringAsFixed(2),
              t.runningBalance.toStringAsFixed(2),
            ]),
      ];
      final csvStr = '\uFEFF${const ListToCsvConverter().convert(rows)}';
      final dir = await getTemporaryDirectory();
      final file = File(
        '${dir.path}/supplier_statement_${widget.supplier.id.substring(0, 6)}.csv',
      );
      await file.writeAsString(csvStr);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تم تصدير كشف الحساب بنجاح (CSV/Excel): ${file.path}')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(backgroundColor: AppColors.lossRed, content: Text('تعذر تصدير CSV: ${formatUserError(e)}')),
      );
    }
  }

  Future<void> _exportPdf() async {
    final stmt = _statement;
    if (stmt == null) return;
    try {
      final fontData = await rootBundle.load('assets/fonts/Titr.ttf');
      final arabicFont = pw.Font.ttf(fontData);
      final doc = pw.Document();

      doc.addPage(
        pw.MultiPage(
          pageFormat: PdfPageFormat.a4,
          textDirection: pw.TextDirection.rtl,
          theme: pw.ThemeData.withFont(base: arabicFont, bold: arabicFont),
          build: (ctx) => [
            pw.Header(
              level: 0,
              child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text('كشف حساب مورد — ${stmt.storeName}', style: const pw.TextStyle(fontSize: 16)),
                  pw.Text('العملة: ${stmt.currencySymbol}', style: const pw.TextStyle(fontSize: 12)),
                ],
              ),
            ),
            pw.Text('المورد: ${stmt.supplier.name}   |   الهاتف: ${stmt.supplier.phone ?? "-"}'),
            pw.SizedBox(height: 8),
            pw.Text(
              'إجمالي الدائن (مشتريات): ${stmt.totalCredit.toStringAsFixed(2)} ${stmt.currencySymbol}   |   '
              'إجمالي المدين (سداد/مرتجع): ${stmt.totalDebit.toStringAsFixed(2)} ${stmt.currencySymbol}   |   '
              'الرصيد المستحق: ${stmt.closingBalance.toStringAsFixed(2)} ${stmt.currencySymbol}',
              style: const pw.TextStyle(fontSize: 11),
            ),
            pw.SizedBox(height: 12),
            pw.TableHelper.fromTextArray(
              headers: ['الرصيد', 'دائن', 'مدين', 'البيان', 'المرجع', 'التاريخ'],
              data: stmt.transactions
                  .map((t) => [
                        t.runningBalance.toStringAsFixed(2),
                        t.credit.toStringAsFixed(2),
                        t.debit.toStringAsFixed(2),
                        t.description,
                        t.reference,
                        t.date.length >= 10 ? t.date.substring(0, 10) : t.date,
                      ])
                  .toList(),
            ),
          ],
        ),
      );

      await Printing.layoutPdf(
        name: 'كشف_حساب_${stmt.supplier.name}.pdf',
        onLayout: (_) async => doc.save(),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(backgroundColor: AppColors.lossRed, content: Text('تعذر تصدير PDF: ${formatUserError(e)}')),
      );
    }
  }

  void _showPaymentDialog(SupplierModel currentSupplier, String symbol) {
    final amountCtrl = TextEditingController(
      text: currentSupplier.currentBalance > 0
          ? currentSupplier.currentBalance.toStringAsFixed(0)
          : '',
    );
    final notesCtrl = TextEditingController();
    String method = 'CASH';
    String? selectedWalletId =
        _wallets.isNotEmpty ? _wallets.first['id']?.toString() : null;
    String? selectedInvoiceId;
    String? receiptPath;

    final openInvoices = (_aging?.openItems ?? [])
        .where((i) => i['reference_number'] != 'OPENING')
        .toList();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
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
                      Text(
                        'سداد دفعة للمورد: ${currentSupplier.name}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'الرصيد المستحق الحالي: ${_numFormat.format(currentSupplier.currentBalance)} $symbol',
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.creditOrange,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: amountCtrl,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: InputDecoration(
                          labelText: 'مبلغ الدفعة المسددة ($symbol) *',
                          prefixIcon: const Icon(Icons.payments_outlined),
                        ),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: method,
                        decoration: const InputDecoration(labelText: 'طريقة السداد'),
                        items: const [
                          DropdownMenuItem(value: 'CASH', child: Text('نقداً من الصندوق')),
                          DropdownMenuItem(
                            value: 'ELECTRONIC',
                            child: Text('محفظة إلكترونية / حوالة'),
                          ),
                        ],
                        onChanged: (v) {
                          if (v != null) setModalState(() => method = v);
                        },
                      ),
                      if (method == 'ELECTRONIC') ...[
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String>(
                          value: selectedWalletId,
                          decoration: const InputDecoration(labelText: 'اختر المحفظة الإلكترونية *'),
                          items: _wallets
                              .map((w) => DropdownMenuItem<String>(
                                    value: w['id']?.toString(),
                                    child: Text(w['name']?.toString() ?? 'محفظة'),
                                  ))
                              .toList(),
                          onChanged: (v) => setModalState(() => selectedWalletId = v),
                        ),
                      ],
                      if (openInvoices.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String?>(
                          value: selectedInvoiceId,
                          decoration: const InputDecoration(
                            labelText: 'تخصيص السداد (اختياري)',
                          ),
                          items: [
                            const DropdownMenuItem<String?>(
                              value: null,
                              child: Text('على الحساب العام (يسدد الأقدم فالأحدث تلقائياً)'),
                            ),
                            ...openInvoices.map(
                              (inv) => DropdownMenuItem<String?>(
                                value: inv['reference_id']?.toString(),
                                child: Text(
                                  'فاتورة ${inv['reference_number']} (متبقي: ${inv['remaining_amount']})',
                                ),
                              ),
                            ),
                          ],
                          onChanged: (v) => setModalState(() => selectedInvoiceId = v),
                        ),
                      ],
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: () async {
                          final picked = await ImagePicker().pickImage(
                            source: ImageSource.gallery,
                            imageQuality: 75,
                          );
                          if (picked != null) {
                            setModalState(() => receiptPath = picked.path);
                          }
                        },
                        icon: const Icon(Icons.attachment),
                        label: Text(
                          receiptPath == null
                              ? 'إرفاق صورة سند / إيصال الحوالة (اختياري)'
                              : 'تم إرفاق صورة السند ✅',
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextFormField(
                        controller: notesCtrl,
                        decoration: const InputDecoration(
                          labelText: 'بيان / ملاحظات السداد',
                        ),
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () async {
                          final amt = double.tryParse(amountCtrl.text) ?? 0.0;
                          if (amt <= 0) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('يرجى إدخال مبلغ سداد أكبر من صفر.')),
                            );
                            return;
                          }
                          if (method == 'ELECTRONIC' &&
                              (selectedWalletId == null || selectedWalletId!.isEmpty)) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('يرجى اختيار المحفظة الإلكترونية.')),
                            );
                            return;
                          }
                          final prov = context.read<SuppliersProvider>();
                          final ownerId = context.read<AuthProvider>().currentAccount?.id;
                          final ok = await prov.recordPayment(
                            supplierId: currentSupplier.id,
                            amount: amt,
                            paymentMethod: method,
                            walletId: method == 'ELECTRONIC' ? selectedWalletId : null,
                            purchaseInvoiceId: selectedInvoiceId,
                            receiptAttachmentUrl: receiptPath,
                            notes: notesCtrl.text,
                            storeOwnerId: ownerId,
                          );
                          if (!mounted) return;
                          if (ok) {
                            if (ctx.mounted) Navigator.pop(ctx);
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('تم تسجيل دفعة السداد للمورد بنجاح ✅')),
                            );
                            _loadData();
                          } else if (prov.errorMessage != null) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                backgroundColor: AppColors.lossRed,
                                content: Text(prov.errorMessage!),
                              ),
                            );
                          }
                        },
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        child: const Text('تأكيد السداد'),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _confirmDelete(SupplierModel s) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('حذف المورد (حذف ناعم)'),
          content: Text(
            s.currentBalance != 0
                ? 'تنبيه: هذا المورد عليه رصيد قائم (${_numFormat.format(s.currentBalance)}). سيرفض النظام الحذف حتى تصفية الرصيد إلى صفر.'
                : 'هل أنت متأكد من أرشفة/حذف المورد "${s.name}"؟ ستبقى فواتيره التاريخية محفوظة.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.lossRed),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('تأكيد الحذف'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || !mounted) return;
    final prov = context.read<SuppliersProvider>();
    final ok = await prov.deleteSupplier(s.id);
    if (!mounted) return;
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حذف المورد بنجاح ✅')),
      );
      Navigator.pop(context);
    } else if (prov.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(backgroundColor: AppColors.lossRed, content: Text(prov.errorMessage!)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _statement?.supplier ?? widget.supplier;
    final symbol = _statement?.currencySymbol ??
        context.watch<StoreSettingsProvider>().currencySymbol;

    return AppScaffold(
      title: 'حساب المورد: ${s.name}',
      actions: [
        IconButton(
          tooltip: 'تصدير PDF',
          icon: const Icon(Icons.picture_as_pdf_outlined),
          onPressed: _statement == null ? null : _exportPdf,
        ),
        IconButton(
          tooltip: 'تصدير CSV / Excel',
          icon: const Icon(Icons.table_chart_outlined),
          onPressed: _statement == null ? null : _exportCsv,
        ),
        PopupMenuButton<String>(
          onSelected: (v) async {
            if (v == 'toggle_status') {
              final next = s.isActive ? 'SUSPENDED' : 'ACTIVE';
              await context.read<SuppliersProvider>().updateSupplier(s.id, status: next);
              _loadData();
            } else if (v == 'delete') {
              _confirmDelete(s);
            }
          },
          itemBuilder: (_) => [
            PopupMenuItem(
              value: 'toggle_status',
              child: Text(s.isActive ? 'إيقاف التعامل مؤقتاً' : 'إعادة تفعيل المورد'),
            ),
            const PopupMenuItem(
              value: 'delete',
              child: Text('حذف المورد', style: TextStyle(color: AppColors.lossRed)),
            ),
          ],
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.cashGreen,
        foregroundColor: Colors.white,
        onPressed: () => _showPaymentDialog(s, symbol),
        icon: const Icon(Icons.payments_outlined),
        label: const Text('سداد دفعة'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadData,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 80),
                children: [
                  // بطاقة رصيد المورد
                  Container(
                    padding: const EdgeInsets.all(16),
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
                            Text(
                              s.name,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 17,
                              ),
                            ),
                            Text(
                              s.phone ?? '',
                              style: const TextStyle(color: AppColors.surfaceMuted, fontSize: 12),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _miniStat('إجمالي المشتريات', _statement?.totalCredit ?? 0, symbol),
                            _miniStat('إجمالي المسدد', _statement?.totalDebit ?? 0, symbol),
                            _miniStat(
                              'المتبقي له',
                              s.currentBalance,
                              symbol,
                              highlight: true,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),

                  // أعمار الديون (Debt Aging)
                  if (_aging != null && _aging!.totalOutstanding > 0) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'أعمار الديون المستحقة',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: AppColors.primary,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                _agingChip('0–30 يوم', _aging!.days0To30, AppColors.cashGreen),
                                const SizedBox(width: 6),
                                _agingChip('31–60 يوم', _aging!.days31To60, AppColors.warning),
                                const SizedBox(width: 6),
                                _agingChip('61–90 يوم', _aging!.days61To90, AppColors.creditOrange),
                                const SizedBox(width: 6),
                                _agingChip('+90 يوم', _aging!.days90Plus, AppColors.lossRed),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],

                  // جدول كشف الحساب التراكمي
                  const Text(
                    'كشف الحساب التراكمي',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(height: 8),

                  if (_statement == null || _statement!.transactions.isEmpty)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Center(child: Text('لا توجد حركات مسجلة لهذا المورد بعد.')),
                      ),
                    )
                  else
                    ..._statement!.transactions.map((tx) {
                      final isCredit = tx.credit > 0;
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          child: Row(
                            children: [
                              CircleAvatar(
                                radius: 18,
                                backgroundColor: isCredit
                                    ? AppColors.creditOrange.withOpacity(0.15)
                                    : AppColors.cashGreen.withOpacity(0.15),
                                child: Icon(
                                  isCredit ? Icons.shopping_bag_outlined : Icons.south_west,
                                  size: 18,
                                  color: isCredit ? AppColors.creditOrange : AppColors.cashGreen,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      tx.description,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '${tx.date.length >= 10 ? tx.date.substring(0, 10) : tx.date} · مرجع: ${tx.reference}',
                                      style: const TextStyle(
                                        fontSize: 11,
                                        color: AppColors.textMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    isCredit
                                        ? '+${_numFormat.format(tx.credit)} $symbol'
                                        : '-${_numFormat.format(tx.debit)} $symbol',
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13,
                                      color: isCredit
                                          ? AppColors.creditOrange
                                          : AppColors.cashGreen,
                                    ),
                                  ),
                                  Text(
                                    'الرصيد: ${_numFormat.format(tx.runningBalance)}',
                                    style: const TextStyle(
                                      fontSize: 10,
                                      color: AppColors.textSecondary,
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

  Widget _miniStat(String label, double val, String symbol, {bool highlight = false}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppColors.surfaceMuted, fontSize: 11)),
        const SizedBox(height: 2),
        Text(
          '${_numFormat.format(val)} $symbol',
          style: TextStyle(
            color: highlight ? AppColors.secondary : Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: highlight ? 15 : 13,
          ),
        ),
      ],
    );
  }

  Widget _agingChip(String label, double val, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          children: [
            Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
            const SizedBox(height: 2),
            Text(
              _numFormat.format(val),
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: color),
            ),
          ],
        ),
      ),
    );
  }
}
