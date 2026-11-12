import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:provider/provider.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/error_formatter.dart';
import '../../../data/local/app_database.dart';
import '../../providers/auth_provider.dart';
import '../../providers/store_settings_provider.dart';
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
    final storeOwnerId = context.read<AuthProvider>().storeOwnerId;
    setState(() => _isLoading = true);
    try {
      final api = ApiClient();
      final endpoint = widget.isManagedOnly ? ApiEndpoints.managedWorkers : ApiEndpoints.workers;
      final res = await api.get(endpoint);
      final list = res.data is List ? res.data as List : <dynamic>[];
      if (storeOwnerId != null) {
        try {
          final db = await AppDatabase.getInstance(storeOwnerId);
          await AppDatabase.applyServerUpdates(db, {'workers': list});
        } catch (_) {}
      }
      if (!mounted) return;
      setState(() {
        _workers = list;
        _isLoading = false;
      });
    } catch (_) {
      if (storeOwnerId != null) {
        try {
          final db = await AppDatabase.getInstance(storeOwnerId);
          final cached = await AppDatabase.getWorkers(db);
          if (mounted) {
            setState(() {
              _workers = cached;
              _isLoading = false;
            });
            return;
          }
        } catch (_) {}
      }
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _showAddWorkerDialog() {
    final nameController = TextEditingController();
    final phoneController = TextEditingController();
    final passwordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    bool isResponsible = false;
    bool permShowCost = false;
    bool permShowSellInventory = false;
    bool permReports = false;
    bool permDamaged = true;
    bool permOwnAdvance = true;
    bool permEditClosingCash = true;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text('إضافة عامل جديد', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(controller: nameController, decoration: const InputDecoration(labelText: 'اسم العامل')),
                  const SizedBox(height: 8),
                  TextField(controller: phoneController, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'رقم الجوال')),
                  const SizedBox(height: 8),
                  TextField(controller: passwordController, obscureText: true, decoration: const InputDecoration(labelText: 'كلمة المرور')),
                  const SizedBox(height: 8),
                  TextField(controller: confirmPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'تأكيد كلمة المرور')),
                  const SizedBox(height: 12),
                  SwitchListTile(
                    title: const Text('تعيين كعامل مسؤول', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primary)),
                    subtitle: const Text('لا يستهلك رصيد موافقات ويمكنه متابعة مبيعات العمال', style: TextStyle(fontSize: 11)),
                    value: isResponsible,
                    activeColor: AppColors.primary,
                    onChanged: (val) => setDialogState(() => isResponsible = val),
                  ),
                  const Divider(),
                  const Text('صلاحيات العامل الفردية', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                  CheckboxListTile(
                    title: const Text('إظهار أسعار البيع والمخزون', style: TextStyle(fontSize: 12)),
                    value: permShowSellInventory,
                    onChanged: (val) => setDialogState(() => permShowSellInventory = val ?? true),
                  ),
                  CheckboxListTile(
                    title: const Text('إظهار سعر التكلفة', style: TextStyle(fontSize: 12)),
                    value: permShowCost,
                    onChanged: (val) => setDialogState(() => permShowCost = val ?? false),
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
                  if (isResponsible)
                    CheckboxListTile(
                      title: const Text('تسجيل سلفة لنفسه (سلفتي)', style: TextStyle(fontSize: 12)),
                      value: permOwnAdvance,
                      onChanged: (val) => setDialogState(() => permOwnAdvance = val ?? false),
                    ),
                  CheckboxListTile(
                    title: const Text('تعديل تسليم النقد بالإغلاق', style: TextStyle(fontSize: 12)),
                    value: permEditClosingCash,
                    onChanged: (val) => setDialogState(() => permEditClosingCash = val ?? false),
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
                  final confirm = confirmPasswordController.text.isNotEmpty
                      ? confirmPasswordController.text
                      : password;

                  if (name.isEmpty || phone.isEmpty || password.isEmpty) return;
                  final messenger = ScaffoldMessenger.of(this.context);
                  if (password != confirm) {
                    messenger.showSnackBar(
                      const SnackBar(content: Text('كلمة المرور وتأكيدها غير متطابقين')),
                    );
                    return;
                  }
                  Navigator.pop(ctx);

                  final payload = {
                    'fullName': name,
                    'phone': phone,
                    'password': password,
                    'passwordConfirmation': confirm,
                    'isResponsible': isResponsible,
                    'permissions': {
                      'damagedGoodsEntry': permDamaged,
                      'showCostPrice': permShowCost,
                      'showSellPricesInventory': permShowSellInventory,
                      'reportsAccess': permReports,
                      'enterOwnAdvance': isResponsible ? permOwnAdvance : false,
                      'editWorkerClosingCash': permEditClosingCash,
                    },
                  };

                  try {
                    final api = ApiClient();
                    await api.post(ApiEndpoints.workers, data: payload);
                    _fetchWorkers();
                  } catch (e) {
                    final errStr = e.toString();
                    if (isResponsible &&
                        (errStr.contains('RESPONSIBLE_WORKER_EXISTS') ||
                            errStr.contains('يوجد عامل مسؤول حالياً') ||
                            (e is ApiException && e.statusCode == 409))) {
                      if (!mounted) return;
                      final replaceConfirmed = await showDialog<bool>(
                        context: this.context,
                        builder: (c) => Directionality(
                          textDirection: TextDirection.rtl,
                          child: AlertDialog(
                            title: const Text(
                              'تأكيد استبدال العامل المسؤول',
                              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                            ),
                            content: const Text(
                              'يوجد عامل مسؤول حالياً بالمتجر.\nهل تريد تأكيد نقل صفة "العامل المسؤول" إلى هذا العامل الجديد وتجريد العامل الحالي منها؟',
                            ),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(c, false),
                                child: const Text('إلغاء'),
                              ),
                              ElevatedButton(
                                onPressed: () => Navigator.pop(c, true),
                                child: const Text('تأكيد الاستبدال'),
                              ),
                            ],
                          ),
                        ),
                      );

                      if (replaceConfirmed == true) {
                        try {
                          final api = ApiClient();
                          await api.post(
                            ApiEndpoints.workers,
                            data: {...payload, 'confirmReplace': true},
                          );
                          _fetchWorkers();
                        } catch (e2) {
                          if (mounted) {
                            messenger.showSnackBar(SnackBar(content: Text(formatUserError(e2))));
                          }
                        }
                      }
                    } else if (mounted) {
                      messenger.showSnackBar(SnackBar(content: Text(formatUserError(e))));
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

  void _showEditWorkerDialog(Map<String, dynamic> worker) {
    final String workerId = (worker['id'] ?? '').toString();
    if (workerId.isEmpty) return;

    final nameController = TextEditingController(
      text: (worker['full_name'] ?? worker['name'] ?? '').toString(),
    );
    final phoneController = TextEditingController(
      text: (worker['phone'] ?? '').toString(),
    );
    final passwordController = TextEditingController();
    final confirmPasswordController = TextEditingController();

    bool isResponsible =
        worker['is_responsible'] == true || worker['is_responsible_worker'] == true;
    final bool initialResponsible = isResponsible;
    bool isSuspended = worker['status'] == 'SUSPENDED';

    final perms = worker['permissions'] is Map
        ? Map<String, dynamic>.from(worker['permissions'])
        : <String, dynamic>{};

    bool permDamaged =
        perms['damagedGoodsEntry'] == true || perms['damaged_goods_entry'] == true;
    bool permShowCost =
        perms['showCostPrice'] == true || perms['show_cost_price'] == true;
    bool permShowSellInventory = perms['showSellPricesInventory'] != false &&
        perms['show_sell_prices_inventory'] != false;
    bool permReports =
        perms['reportsAccess'] == true || perms['reports_access'] == true;
    bool permOwnAdvance =
        perms['enterOwnAdvance'] == true || perms['enter_own_advance'] == true;
    bool permEditClosingCash = perms['editWorkerClosingCash'] == true ||
        perms['edit_worker_closing_cash'] == true;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text(
              'تعديل بيانات وصلاحيات العامل',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: nameController,
                    decoration: const InputDecoration(labelText: 'اسم العامل'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: phoneController,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'رقم الجوال'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: passwordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'كلمة مرور جديدة (اختياري)',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: confirmPasswordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'تأكيد كلمة المرور الجديدة',
                    ),
                  ),
                  const SizedBox(height: 10),
                  SwitchListTile(
                    title: const Text(
                      'عامل مسؤول',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                    ),
                    value: isResponsible,
                    activeColor: AppColors.primary,
                    onChanged: (val) => setDialogState(() => isResponsible = val),
                  ),
                  SwitchListTile(
                    title: Text(
                      isSuspended ? 'الحالة: موقوف مؤقتاً' : 'الحالة: نشط',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: isSuspended ? AppColors.lossRed : AppColors.cashGreen,
                      ),
                    ),
                    value: !isSuspended,
                    activeColor: AppColors.cashGreen,
                    onChanged: (val) => setDialogState(() => isSuspended = !val),
                  ),
                  const Divider(),
                  const Text(
                    'صلاحيات العامل الفردية',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                  ),
                  CheckboxListTile(
                    title: const Text('إظهار أسعار البيع والمخزون', style: TextStyle(fontSize: 12)),
                    value: permShowSellInventory,
                    onChanged: (val) =>
                        setDialogState(() => permShowSellInventory = val ?? true),
                  ),
                  CheckboxListTile(
                    title: const Text('إظهار سعر التكلفة', style: TextStyle(fontSize: 12)),
                    value: permShowCost,
                    onChanged: (val) =>
                        setDialogState(() => permShowCost = val ?? false),
                  ),
                  CheckboxListTile(
                    title: const Text('الاطلاع على التقارير', style: TextStyle(fontSize: 12)),
                    value: permReports,
                    onChanged: (val) =>
                        setDialogState(() => permReports = val ?? false),
                  ),
                  CheckboxListTile(
                    title: const Text('تسجيل التالف', style: TextStyle(fontSize: 12)),
                    value: permDamaged,
                    onChanged: (val) =>
                        setDialogState(() => permDamaged = val ?? false),
                  ),
                  if (isResponsible)
                    CheckboxListTile(
                      title: const Text('تسجيل سلفة لنفسه (سلفتي)', style: TextStyle(fontSize: 12)),
                      value: permOwnAdvance,
                      onChanged: (val) =>
                          setDialogState(() => permOwnAdvance = val ?? false),
                    ),
                  CheckboxListTile(
                    title: const Text('تعديل تسليم النقد بالإغلاق', style: TextStyle(fontSize: 12)),
                    value: permEditClosingCash,
                    onChanged: (val) =>
                        setDialogState(() => permEditClosingCash = val ?? false),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () async {
                  final messenger = ScaffoldMessenger.of(this.context);
                  final workerName = nameController.text.trim();
                  final nav = Navigator.of(ctx);
                  final deleteConfirmed = await showDialog<bool>(
                    context: this.context,
                    builder: (c) => Directionality(
                      textDirection: TextDirection.rtl,
                      child: AlertDialog(
                        title: const Text(
                          'تأكيد حذف العامل',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                            color: AppColors.lossRed,
                          ),
                        ),
                        content: Text(
                          'هل أنت متأكد من حذف العامل ($workerName)؟\n\n'
                          '• سيتم إيقاف حساب العامل فوراً وتحرير رصيد الموافقة لإضافة عامل بديل.\n'
                          '• ستبقى كافة المبيعات وسجلات الإغلاق والعمليات المحاسبية السابقة محفوظة بالكامل في النظام للتدقيق والمطابقة دون أي مساس بها.',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(c, false),
                            child: const Text('إلغاء'),
                          ),
                          ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.lossRed,
                            ),
                            onPressed: () => Navigator.pop(c, true),
                            child: const Text('تأكيد الحذف', style: TextStyle(color: Colors.white)),
                          ),
                        ],
                      ),
                    ),
                  );

                  if (deleteConfirmed != true) return;
                  nav.pop();
                  try {
                    await ApiClient().delete(ApiEndpoints.workerDetails(workerId));
                    _fetchWorkers();
                  } catch (e) {
                    if (mounted) {
                      messenger.showSnackBar(SnackBar(content: Text(formatUserError(e))));
                    }
                  }
                },
                child: const Text('حذف العامل', style: TextStyle(color: AppColors.lossRed)),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('إلغاء'),
              ),
              ElevatedButton(
                onPressed: () async {
                  final name = nameController.text.trim();
                  final phone = phoneController.text.trim();
                  final newPass = passwordController.text;
                  final confirmPass = confirmPasswordController.text.isNotEmpty
                      ? confirmPasswordController.text
                      : newPass;
                  final messenger = ScaffoldMessenger.of(this.context);

                  if (newPass.isNotEmpty && newPass != confirmPass) {
                    messenger.showSnackBar(
                      const SnackBar(content: Text('كلمة المرور وتأكيدها غير متطابقين')),
                    );
                    return;
                  }
                  Navigator.pop(ctx);

                  try {
                    final api = ApiClient();
                    await api.patch(
                      ApiEndpoints.workerDetails(workerId),
                      data: {
                        if (name.isNotEmpty) 'fullName': name,
                        if (phone.isNotEmpty) 'phone': phone,
                        'permissions': {
                          'damagedGoodsEntry': permDamaged,
                          'showCostPrice': permShowCost,
                          'showSellPricesInventory': permShowSellInventory,
                          'reportsAccess': permReports,
                          'enterOwnAdvance': isResponsible ? permOwnAdvance : false,
                          'editWorkerClosingCash': permEditClosingCash,
                        },
                      },
                    );
                    if (newPass.isNotEmpty) {
                      await api.patch(
                        ApiEndpoints.workerPassword(workerId),
                        data: {
                          'newPassword': newPass,
                          'newPasswordConfirmation': confirmPass,
                        },
                      );
                    }
                    final wasSuspended = worker['status'] == 'SUSPENDED';
                    if (wasSuspended != isSuspended) {
                      await api.patch(
                        ApiEndpoints.workerSuspend(workerId),
                        data: {'suspended': isSuspended},
                      );
                    }
                    if (initialResponsible != isResponsible) {
                      if (isResponsible) {
                        await api.post(
                          ApiEndpoints.workerPromoteResponsible(workerId),
                          data: {'confirmReplace': true},
                        );
                      } else {
                        await api.post(
                          ApiEndpoints.workerDemoteResponsible(workerId),
                        );
                      }
                    }
                    _fetchWorkers();
                  } catch (e) {
                    if (mounted) {
                      messenger.showSnackBar(SnackBar(content: Text(formatUserError(e))));
                    }
                  }
                },
                child: const Text('حفظ التعديلات'),
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
                      final w = _workers[index] is Map
                          ? Map<String, dynamic>.from(_workers[index] as Map)
                          : <String, dynamic>{};
                      final name = (w['full_name'] ?? w['name'] ?? '').toString();
                      final phone = (w['phone'] ?? '').toString();
                      final bool isResp =
                          w['is_responsible'] == true || w['is_responsible_worker'] == true;
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
                                  child: const Text('مسؤول', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                                ),
                              ],
                            ],
                          ),
                          subtitle: Text(
                            widget.isManagedOnly && todaySales != null
                                ? 'مبيعات اليوم: ${_currencyFormat.format(todaySales)} $symbol'
                                : '$phone · ${isSuspended ? "موقوف مؤقتاً" : "نشط"}',
                            style: TextStyle(
                              fontSize: 12,
                              color: isSuspended ? AppColors.lossRed : AppColors.textSecondary,
                            ),
                          ),
                          trailing: isOwner
                              ? IconButton(
                                  icon: const Icon(Icons.edit_outlined, size: 20),
                                  onPressed: () => _showEditWorkerDialog(w),
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
