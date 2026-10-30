import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/purchases_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../widgets/app_scaffold.dart';
import 'purchase_detail_screen.dart';

/// شاشة قائمة فواتير المشتريات والفلترة (حصري لمالك المتجر)
class PurchasesScreen extends StatefulWidget {
  const PurchasesScreen({super.key});

  @override
  State<PurchasesScreen> createState() => _PurchasesScreenState();
}

class _PurchasesScreenState extends State<PurchasesScreen> {
  final _searchCtrl = TextEditingController();
  final _numFormat = NumberFormat('#,##0.##', 'ar');
  String? _statusFilter; // null | POSTED | DRAFT | VOIDED
  String? _paymentFilter; // null | CASH | CREDIT | PARTIAL | ELECTRONIC

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final ownerId = context.read<AuthProvider>().currentAccount?.id;
    await context.read<PurchasesProvider>().fetchPurchases(
          status: _statusFilter,
          paymentType: _paymentFilter,
          search: _searchCtrl.text,
          storeOwnerId: ownerId,
        );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final prov = context.watch<PurchasesProvider>();
    final settings = context.watch<StoreSettingsProvider>();
    final symbol = prov.currencySymbol.isNotEmpty
        ? prov.currencySymbol
        : settings.currencySymbol;

    if (!auth.canManagePurchases) {
      return const AppScaffold(
        title: 'المشتريات وفواتير التوريد',
        body: Center(child: Text('هذه الشاشة مخصصة لمالك المتجر فقط.')),
      );
    }

    return AppScaffold(
      title: 'المشتريات وفواتير التوريد',
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        onPressed: () async {
          await Navigator.pushNamed(context, '/purchases/create');
          if (mounted) _refresh();
        },
        icon: const Icon(Icons.add_shopping_cart),
        label: const Text('فاتورة شراء جديدة'),
      ),
      body: Column(
        children: [
          // ملخص فواتير المشتريات
          Container(
            margin: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _statCol('إجمالي المشتريات', prov.summaryTotal, symbol, AppColors.secondary),
                _statCol('المسدد', prov.summaryPaid, symbol, Colors.white),
                _statCol('الآجل المتبقي', prov.summaryRemaining, symbol, Colors.orangeAccent),
              ],
            ),
          ),

          // البحث والفلاتر
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: TextField(
              controller: _searchCtrl,
              onSubmitted: (_) => _refresh(),
              decoration: InputDecoration(
                hintText: 'ابحث برقم الفاتورة أو اسم المورد...',
                prefixIcon: const Icon(Icons.search),
                isDense: true,
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchCtrl.clear();
                          _refresh();
                        },
                      )
                    : null,
              ),
            ),
          ),

          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Row(
              children: [
                _filterChip('الكل', _statusFilter == null && _paymentFilter == null, () {
                  setState(() {
                    _statusFilter = null;
                    _paymentFilter = null;
                  });
                  _refresh();
                }),
                const SizedBox(width: 6),
                _filterChip('معتمدة', _statusFilter == 'POSTED', () {
                  setState(() => _statusFilter = _statusFilter == 'POSTED' ? null : 'POSTED');
                  _refresh();
                }),
                const SizedBox(width: 6),
                _filterChip('مسودات', _statusFilter == 'DRAFT', () {
                  setState(() => _statusFilter = _statusFilter == 'DRAFT' ? null : 'DRAFT');
                  _refresh();
                }),
                const SizedBox(width: 6),
                _filterChip('آجل / جزئي', _paymentFilter == 'CREDIT', () {
                  setState(() => _paymentFilter = _paymentFilter == 'CREDIT' ? null : 'CREDIT');
                  _refresh();
                }),
                const SizedBox(width: 6),
                _filterChip('نقدي', _paymentFilter == 'CASH', () {
                  setState(() => _paymentFilter = _paymentFilter == 'CASH' ? null : 'CASH');
                  _refresh();
                }),
              ],
            ),
          ),

          Expanded(
            child: prov.isLoading
                ? const Center(child: CircularProgressIndicator())
                : prov.purchases.isEmpty
                    ? const Center(
                        child: Text('لا توجد فواتير مشتريات مطابقة. اضغط "فاتورة شراء جديدة" للبدء.'),
                      )
                    : RefreshIndicator(
                        onRefresh: _refresh,
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(14, 8, 14, 80),
                          itemCount: prov.purchases.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, idx) {
                            final inv = prov.purchases[idx];
                            final badgeColor = inv.isVoided
                                ? AppColors.lossRed
                                : inv.isDraft
                                    ? AppColors.warning
                                    : AppColors.cashGreen;

                            return Card(
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: badgeColor.withOpacity(0.15),
                                  child: Icon(
                                    inv.isDraft
                                        ? Icons.edit_note
                                        : inv.isVoided
                                            ? Icons.block
                                            : Icons.receipt_long,
                                    color: badgeColor,
                                  ),
                                ),
                                title: Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        '${inv.invoiceNumber} · ${inv.supplierName}',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 8,
                                        vertical: 2,
                                      ),
                                      decoration: BoxDecoration(
                                        color: badgeColor.withOpacity(0.12),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Text(
                                        PurchaseInvoiceModel.statusLabelAr(inv.status),
                                        style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                          color: badgeColor,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                subtitle: Text(
                                  '${inv.invoiceDate.length >= 10 ? inv.invoiceDate.substring(0, 10) : inv.invoiceDate} · ${PurchaseInvoiceModel.paymentTypeLabelAr(inv.paymentType)}'
                                  '${inv.remainingAmount > 0 ? " · متبقي: ${_numFormat.format(inv.remainingAmount)}" : ""}',
                                  style: const TextStyle(fontSize: 11),
                                ),
                                trailing: Text(
                                  '${_numFormat.format(inv.totalAmount)} $symbol',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                    color: AppColors.primary,
                                  ),
                                ),
                                onTap: () async {
                                  await Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) =>
                                          PurchaseDetailScreen(invoiceId: inv.id),
                                    ),
                                  );
                                  if (mounted) _refresh();
                                },
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

  Widget _statCol(String label, double val, String symbol, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppColors.surfaceMuted, fontSize: 11)),
        const SizedBox(height: 3),
        Text(
          '${_numFormat.format(val)} $symbol',
          style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 14),
        ),
      ],
    );
  }

  Widget _filterChip(String label, bool selected, VoidCallback onTap) {
    return ChoiceChip(
      label: Text(label, style: const TextStyle(fontSize: 12)),
      selected: selected,
      selectedColor: AppColors.secondary.withOpacity(0.45),
      onSelected: (_) => onTap(),
    );
  }
}

