import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../providers/store_settings_provider.dart';
import '../../providers/suppliers_provider.dart';
import '../../widgets/app_scaffold.dart';
import 'supplier_detail_screen.dart';

/// شاشة إدارة الموردين وحساباتهم الدائنة (حصري لمالك المتجر)
class SuppliersScreen extends StatefulWidget {
  const SuppliersScreen({super.key});

  @override
  State<SuppliersScreen> createState() => _SuppliersScreenState();
}

class _SuppliersScreenState extends State<SuppliersScreen> {
  final _searchController = TextEditingController();
  final _numFormat = NumberFormat('#,##0.##', 'ar');
  bool _onlyWithDebt = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final ownerId = context.read<AuthProvider>().currentAccount?.id;
    await context.read<SuppliersProvider>().fetchSuppliers(
          search: _searchController.text,
          onlyWithDebt: _onlyWithDebt,
          storeOwnerId: ownerId,
        );
  }

  void _showAddSupplierSheet() {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final addressCtrl = TextEditingController();
    final contactCtrl = TextEditingController();
    final openingCtrl = TextEditingController(text: '0');
    final limitCtrl = TextEditingController();
    final termsCtrl = TextEditingController();
    final notesCtrl = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
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
                    'إضافة مورد جديد',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'اسم المورد / المزرعة *',
                      prefixIcon: Icon(Icons.person_outline),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: phoneCtrl,
                          keyboardType: TextInputType.phone,
                          decoration: const InputDecoration(
                            labelText: 'رقم الهاتف',
                            prefixIcon: Icon(Icons.phone_outlined),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextFormField(
                          controller: contactCtrl,
                          decoration: const InputDecoration(
                            labelText: 'جهة الاتصال / الوكيل',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: addressCtrl,
                    decoration: const InputDecoration(
                      labelText: 'العنوان / المنطقة (مثال: همدان، أرحب)',
                      prefixIcon: Icon(Icons.location_on_outlined),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: openingCtrl,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(
                            labelText: 'رصيد افتتاحي مستحق له',
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextFormField(
                          controller: limitCtrl,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(
                            labelText: 'سقف المديونية (اختياري)',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: termsCtrl,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'مهلة السداد بالأيام',
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextFormField(
                          controller: notesCtrl,
                          decoration: const InputDecoration(
                            labelText: 'ملاحظات',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  ElevatedButton(
                    onPressed: () async {
                      if (nameCtrl.text.trim().length < 2) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('يرجى إدخال اسم المورد (حرفان على الأقل).')),
                        );
                        return;
                      }
                      final prov = context.read<SuppliersProvider>();
                      final ownerId = context.read<AuthProvider>().currentAccount?.id;
                      final created = await prov.createSupplier(
                        name: nameCtrl.text,
                        phone: phoneCtrl.text,
                        address: addressCtrl.text,
                        contactPerson: contactCtrl.text,
                        notes: notesCtrl.text,
                        openingBalance: double.tryParse(openingCtrl.text) ?? 0.0,
                        creditLimit: double.tryParse(limitCtrl.text),
                        paymentTermsDays: int.tryParse(termsCtrl.text),
                        storeOwnerId: ownerId,
                      );
                      if (!mounted) return;
                      if (created != null) {
                        if (ctx.mounted) Navigator.pop(ctx);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('تم إضافة المورد بنجاح ✅')),
                        );
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
                    child: const Text('حفظ المورد'),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final prov = context.watch<SuppliersProvider>();
    final settings = context.watch<StoreSettingsProvider>();
    final symbol = prov.currencySymbol.isNotEmpty
        ? prov.currencySymbol
        : settings.currencySymbol;

    if (!auth.canManageSuppliers) {
      return const AppScaffold(
        title: 'الموردون وحساباتهم',
        body: Center(child: Text('هذه الشاشة مخصصة لمالك المتجر فقط.')),
      );
    }

    return AppScaffold(
      title: 'الموردون وحساباتهم',
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        onPressed: _showAddSupplierSheet,
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('مورد جديد'),
      ),
      body: Column(
        children: [
          // ملخص الذمم الدائنة المستحقة للموردين
          Container(
            margin: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [AppColors.primaryDark, AppColors.primary],
                begin: Alignment.topRight,
                end: Alignment.bottomLeft,
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'إجمالي مستحقات الموردين (حساب 2000)',
                      style: TextStyle(color: AppColors.surfaceMuted, fontSize: 12),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${_numFormat.format(prov.totalPayables)} $symbol',
                      style: const TextStyle(
                        color: AppColors.secondary,
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '${prov.totalCount} مورد',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),

          // البحث والفلترة
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    onSubmitted: (_) => _refresh(),
                    decoration: InputDecoration(
                      hintText: 'ابحث باسم المورد أو رقم الهاتف...',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _searchController.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, size: 18),
                              onPressed: () {
                                _searchController.clear();
                                _refresh();
                              },
                            )
                          : null,
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilterChip(
                  label: const Text('عليهم مستحقات', style: TextStyle(fontSize: 12)),
                  selected: _onlyWithDebt,
                  selectedColor: AppColors.secondary.withOpacity(0.4),
                  onSelected: (v) {
                    setState(() => _onlyWithDebt = v);
                    _refresh();
                  },
                ),
              ],
            ),
          ),

          Expanded(
            child: prov.isLoading
                ? const Center(child: CircularProgressIndicator())
                : prov.suppliers.isEmpty
                    ? const Center(
                        child: Text('لا يوجد موردون مسجلون حالياً. اضغط "مورد جديد" للإضافة.'),
                      )
                    : RefreshIndicator(
                        onRefresh: _refresh,
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(14, 8, 14, 80),
                          itemCount: prov.suppliers.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, idx) {
                            final s = prov.suppliers[idx];
                            return Card(
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: s.isActive
                                      ? AppColors.secondary.withOpacity(0.25)
                                      : AppColors.surfaceMuted,
                                  child: Text(
                                    s.name.isNotEmpty ? s.name.substring(0, 1) : 'م',
                                    style: const TextStyle(
                                      color: AppColors.primary,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                                title: Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        s.name,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                    if (!s.isActive)
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 6,
                                          vertical: 2,
                                        ),
                                        decoration: BoxDecoration(
                                          color: AppColors.lossRed.withOpacity(0.12),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: const Text(
                                          'موقوف',
                                          style: TextStyle(
                                            fontSize: 10,
                                            color: AppColors.lossRed,
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                                subtitle: Text(
                                  [
                                    if (s.phone != null && s.phone!.isNotEmpty) s.phone!,
                                    if (s.address != null && s.address!.isNotEmpty) s.address!,
                                  ].join(' · '),
                                  style: const TextStyle(fontSize: 12),
                                ),
                                trailing: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      '${_numFormat.format(s.currentBalance)} $symbol',
                                      style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 14,
                                        color: s.hasDebt
                                            ? AppColors.creditOrange
                                            : AppColors.cashGreen,
                                      ),
                                    ),
                                    Text(
                                      s.hasDebt ? 'مستحق للمورد' : 'مسدد بالكامل',
                                      style: const TextStyle(
                                        fontSize: 10,
                                        color: AppColors.textMuted,
                                      ),
                                    ),
                                  ],
                                ),
                                onTap: () async {
                                  await Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => SupplierDetailScreen(supplier: s),
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
}
