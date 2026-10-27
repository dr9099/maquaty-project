import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة إدارة العمال — الشاشات 18 و19 و20 و22 و27 و31
class WorkersScreen extends StatefulWidget {
  final bool isManagedOnly;
  const WorkersScreen({super.key, this.isManagedOnly = false});

  @override
  State<WorkersScreen> createState() => _WorkersScreenState();
}

class _WorkersScreenState extends State<WorkersScreen> {
  final _currencyFormat = NumberFormat('#,##0', 'ar');
  bool _isLoading = true;
  List<dynamic> _workers = [];

  @override
  void initState() {
    super.initState();
    _fetchWorkers();
  }

  Future<void> _fetchWorkers() async {
    setState(() => _isLoading = true);
    try {
      final api = ApiClient();
      final endpoint = widget.isManagedOnly ? ApiEndpoints.managedWorkers : ApiEndpoints.workers;
      final res = await api.get(endpoint);
      setState(() {
        _workers = res.data ?? [];
        _isLoading = false;
      });
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  void _showAddWorkerDialog() {
    final nameController = TextEditingController();
    final phoneController = TextEditingController();
    final passwordController = TextEditingController();
    bool isResponsible = false;
    bool permEmergency = true;
    bool permReports = false;
    bool permDamaged = false;
    bool permExpenses = false;
    bool permOwnAdvance = true;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text('إضافة عامل جديد (22-worker-add)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(controller: nameController, decoration: const InputDecoration(labelText: 'اسم العامل')),
                  const SizedBox(height: 8),
                  TextField(controller: phoneController, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'رقم الجوال')),
                  const SizedBox(height: 8),
                  TextField(controller: passwordController, decoration: const InputDecoration(labelText: 'كلمة المرور المؤقتة')),
                  const SizedBox(height: 12),
                  SwitchListTile(
                    title: const Text('تعيين كعامل مسؤول (R-33)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primary)),
                    subtitle: const Text('لا يستهلك رصيد موافقات ويمكنه متابعة مبيعات العمال', style: TextStyle(fontSize: 11)),
                    value: isResponsible,
                    activeColor: AppColors.primary,
                    onChanged: (val) => setDialogState(() => isResponsible = val),
                  ),
                  const Divider(),
                  const Text('صلاحيات العامل الفردية', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                  CheckboxListTile(
                    title: const Text('البيع الاضطراري', style: TextStyle(fontSize: 12)),
                    value: permEmergency,
                    onChanged: (val) => setDialogState(() => permEmergency = val ?? true),
                  ),
                  CheckboxListTile(
                    title: const Text('الاطلاع على التقارير', style: TextStyle(fontSize: 12)),
                    value: permReports,
                    onChanged: (val) => setDialogState(() => permReports = val ?? false),
                  ),
                  CheckboxListTile(
                    title: const Text('تسجيل التالف', style: TextStyle(fontSize: 12)),
                    value: permDamaged,
                    onChanged: (val) => setDialogState(() => permDamaged = val ?? false),
                  ),
                  CheckboxListTile(
                    title: const Text('تسجيل سلفة لنفسه (سلفتي)', style: TextStyle(fontSize: 12)),
                    value: permOwnAdvance,
                    onChanged: (val) => setDialogState(() => permOwnAdvance = val ?? false),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
              ElevatedButton(
                onPressed: () async {
                  final name = nameController.text.trim();
                  final phone = phoneController.text.trim();
                  final password = passwordController.text;

                  if (name.isEmpty || phone.isEmpty || password.isEmpty) return;
                  final messenger = ScaffoldMessenger.of(context);
                  Navigator.pop(ctx);

                  try {
                    final api = ApiClient();
                    await api.post(ApiEndpoints.workers, data: {
                      'name': name,
                      'phone': phone,
                      'password': password,
                      'isResponsibleWorker': isResponsible,
                      'permEmergencySales': permEmergency,
                      'permReportsAccess': permReports,
                      'permDamagedGoods': permDamaged,
                      'permExpensesView': permExpenses,
                      'permEnterOwnAdvance': permOwnAdvance,
                    });
                    _fetchWorkers();
                  } catch (e) {
                    if (mounted) {
                      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  }
                },
                child: const Text('إضافة'),
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
    final isOwner = auth.isOwner;

    return AppScaffold(
      title: widget.isManagedOnly ? 'العمال المدارين' : 'إدارة العمال',
      floatingActionButton: isOwner && !widget.isManagedOnly
          ? FloatingActionButton(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              onPressed: _showAddWorkerDialog,
              child: const Icon(Icons.person_add),
            )
          : null,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _workers.isEmpty
              ? const Center(child: Text('لا يوجد عمال مسجلين بعد'))
              : RefreshIndicator(
                  onRefresh: _fetchWorkers,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(14),
                    itemCount: _workers.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final w = _workers[index];
                      final name = w['name'] ?? '';
                      final phone = w['phone'] ?? '';
                      final bool isResp = w['is_responsible_worker'] ?? false;
                      final bool isSuspended = w['status'] == 'SUSPENDED';
                      final double? todaySales = (w['today_sales'] as num?)?.toDouble();

                      return Card(
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: isResp ? AppColors.secondary : AppColors.surfaceMuted,
                            child: Icon(isResp ? Icons.star : Icons.person, color: AppColors.primary),
                          ),
                          title: Row(
                            children: [
                              Text(name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                              if (isResp) ...[
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppColors.secondary.withOpacity(0.3),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: const Text('مسؤول (R-33)', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                                ),
                              ],
                            ],
                          ),
                          subtitle: Text(
                            widget.isManagedOnly && todaySales != null
                                ? 'مبيعات اليوم: ${_currencyFormat.format(todaySales)} ريال'
                                : '$phone · ${isSuspended ? "موقوف مؤقتاً" : "نشط"}',
                            style: TextStyle(
                              fontSize: 12,
                              color: isSuspended ? AppColors.lossRed : AppColors.textSecondary,
                            ),
                          ),
                          trailing: isOwner
                              ? IconButton(
                                  icon: const Icon(Icons.edit_outlined, size: 20),
                                  onPressed: () {},
                                )
                              : null,
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
