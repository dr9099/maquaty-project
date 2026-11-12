import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/utils/error_formatter.dart';
import '../../providers/auth_provider.dart';
import '../../providers/sync_provider.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة النسخ الاحتياطي والاستعادة — الشاشات 23 و25 و30 (BACKUP_RESTORE / RESTORE_CONFIRM / BACKUP_PAYWALL_MODAL)
class BackupScreen extends StatefulWidget {
  const BackupScreen({super.key});

  @override
  State<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends State<BackupScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  void _loadData() {
    final auth = context.read<AuthProvider>();
    final storeOwnerId = auth.currentAccount?.id;
    if (storeOwnerId != null && storeOwnerId.isNotEmpty) {
      context.read<SyncProvider>().loadStatus(storeOwnerId);
    }
  }

  String _formatDate(DateTime dt) {
    final y = dt.year;
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    final h = dt.hour.toString().padLeft(2, '0');
    final min = dt.minute.toString().padLeft(2, '0');
    return '$y/$m/$d $h:$min';
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes بايت';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} ك.بايت';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(2)} م.بايت';
  }

  Future<void> _createLocalBackup() async {
    final auth = context.read<AuthProvider>();
    final sync = context.read<SyncProvider>();
    final storeOwnerId = auth.currentAccount?.id;
    if (storeOwnerId == null || storeOwnerId.isEmpty) return;

    try {
      final info = await sync.createLocalBackup(storeOwnerId);
      final sizeStr = _formatBytes(info['sizeBytes'] as int? ?? 0);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('تم إنشاء وحفظ النسخة الاحتياطية بنجاح ($sizeStr) ✅'),
            backgroundColor: AppColors.cashGreen,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('تعذر إنشاء النسخة الاحتياطية: ${formatUserError(e)}'),
            backgroundColor: AppColors.lossRed,
          ),
        );
      }
    }
  }

  Future<void> _handleCloudSync() async {
    final auth = context.read<AuthProvider>();
    final sync = context.read<SyncProvider>();
    final storeOwnerId = auth.currentAccount?.id;
    if (storeOwnerId == null || storeOwnerId.isEmpty) return;

    // فحص الاشتراك الفعلي وفق قاعدة BR-076 و R-28
    final status = sync.subscriptionStatus ?? auth.currentAccount?.accountStatus ?? 'TRIAL';
    final isTrial = status == 'TRIAL' || status == 'TRIAL_WARNING' || status == 'TRIAL_EXPIRED';

    if (isTrial) {
      _showPaywallModal();
      return;
    }

    try {
      final result = await sync.syncWithServer(
        storeOwnerId: storeOwnerId,
        onStatusUpdated: (newStatus) => auth.updateAccountStatus(newStatus),
        onMinVersionRequired: (minVer) => auth.lockForAppUpdate(minVer),
      );

      if (mounted) {
        if (result.success) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'تمت المزامنة السحابية بنجاح! تم تجهيز (${result.processedCount}) عملية، إصدار المزامنة #${result.newSyncVersion} ✅',
              ),
              backgroundColor: AppColors.cashGreen,
            ),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('فشلت المزامنة: ${formatUserError(result.errorMessage)}'),
              backgroundColor: AppColors.lossRed,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('حدث خطأ أثناء المزامنة: ${formatUserError(e)}'),
            backgroundColor: AppColors.lossRed,
          ),
        );
      }
    }
  }

  void _showPaywallModal() {
    // نافذة الاشتراك المطلوب (الشاشة 30 — 30-backup-paywall-modal.jpg)
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.secondary.withOpacity(0.3),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.cloud_upload_outlined, size: 36, color: AppColors.primary),
              ),
              const SizedBox(height: 14),
              const Text(
                'النسخ الاحتياطي السحابي ميزة خاصة بالمشتركين',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.primary),
              ),
              const SizedBox(height: 8),
              const Text(
                'أنت الآن في الفترة التجريبية. اشترك في مَقوتي لتفعيل الحفظ السحابي الآلي التلقائي وحماية بياناتك من الضياع.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('ترقية الحساب والاشتراك الآن'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showRestoreConfirmDialog() {
    // تأكيد استيراد نسخة احتياطية (الشاشة 25 — 25-restore-confirm.jpg)
    showDialog(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: AppColors.lossRed),
              SizedBox(width: 8),
              Text('تحذير استعادة البيانات', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppColors.lossRed)),
            ],
          ),
          content: const Text(
            'استيراد هذه النسخة الاحتياطية سيستبدل كافة البيانات المحلية الحالية بالكامل ببيانات آخر نسخة احتياطية محلية محفوظة ولا يمكن التراجع عن هذا الإجراء.\n\nهل أنت متأكد من الاستمرار؟',
            style: TextStyle(fontSize: 13),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.lossRed),
              onPressed: () async {
                Navigator.pop(ctx);
                final auth = context.read<AuthProvider>();
                final sync = context.read<SyncProvider>();
                final storeOwnerId = auth.currentAccount?.id;
                if (storeOwnerId == null || storeOwnerId.isEmpty) return;

                try {
                  await sync.restoreLocalBackup(storeOwnerId);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('تمت استعادة النسخة الاحتياطية بنجاح وأعيد تحميل المتجر ✅'),
                        backgroundColor: AppColors.cashGreen,
                      ),
                    );
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('تعذر استعادة النسخة الاحتياطية: ${formatUserError(e)}'),
                        backgroundColor: AppColors.lossRed,
                      ),
                    );
                  }
                }
              },
              child: const Text('نعم، استبدال واستعادة'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    // فحص صلاحية الوصول: المالك أو العامل المسؤول فقط (R-12 / BR-010)
    if (!auth.canAccessBackup) {
      return const AppScaffold(
        title: 'النسخ الاحتياطي والاستعادة',
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.lock_outline, size: 64, color: AppColors.lossRed),
                SizedBox(height: 16),
                Text(
                  'عذراً، هذه الشاشة مخصصة لمالك المتجر والعامل المسؤول فقط.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                ),
                SizedBox(height: 8),
                Text(
                  'ليس لديك الصلاحية للوصول لوظائف النسخ الاحتياطي أو استعادة البيانات.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final sync = context.watch<SyncProvider>();

    return AppScaffold(
      title: 'النسخ الاحتياطي والاستعادة',
      body: RefreshIndicator(
        onRefresh: () async => _loadData(),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // بطاقة ملخص المزامنة وحالة العمليات المعلقة
            Card(
              color: sync.pendingCount > 0 ? AppColors.warning.withOpacity(0.12) : AppColors.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: sync.pendingCount > 0 ? AppColors.warning : Colors.transparent,
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          sync.pendingCount > 0 ? Icons.sync_problem_outlined : Icons.check_circle_outline,
                          color: sync.pendingCount > 0 ? AppColors.warning : AppColors.cashGreen,
                          size: 24,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          sync.pendingCount > 0
                              ? 'يوجد ${sync.pendingCount} عملية بانتظار المزامنة'
                              : 'كافة العمليات المحلية متزامنة بالكامل',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                            color: sync.pendingCount > 0 ? AppColors.warning : AppColors.cashGreen,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      sync.lastSyncAt != null
                          ? 'آخر مزامنة سحابية: ${_formatDate(sync.lastSyncAt!)} (إصدار #${sync.lastSyncVersion})'
                          : 'لم تتم المزامنة السحابية بعد.',
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),

            // بطاقة النسخ المحلي
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.phone_android_outlined, color: AppColors.primary),
                        SizedBox(width: 8),
                        Text('نسخة احتياطية محلية على الهاتف', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'تُحفظ قاعدة البيانات في ذاكرة الهاتف الداخلية ويمكنك نقلها أو استعادتها بأي وقت دون إنترنت.',
                      style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                    if (sync.lastBackupAt != null) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: AppColors.background,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          'آخر نسخة محلية: ${_formatDate(sync.lastBackupAt!)} (${_formatBytes(sync.lastBackupSizeBytes ?? 0)})',
                          style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
                        ),
                      ),
                    ],
                    const SizedBox(height: 14),
                    ElevatedButton.icon(
                      icon: sync.isBackingUp
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.download),
                      label: const Text('إنشاء نسخة محلية الآن'),
                      onPressed: sync.isBackingUp ? null : _createLocalBackup,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),

            // بطاقة النسخ السحابي
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.cloud_outlined, color: AppColors.electronicBlue),
                        SizedBox(width: 8),
                        Text('النسخ الاحتياطي السحابي المشفر', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'مزامنة وحفظ نسخة مشفرة في خوادم مَقوتي السحابية لحماية محلك من فقدان الهاتف أو تلفه.',
                      style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 14),
                    OutlinedButton.icon(
                      icon: sync.isSyncing
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.cloud_upload_outlined),
                      label: Text(sync.isSyncing ? 'جارٍ المزامنة السحابية...' : 'مزامنة سحابية الآن'),
                      onPressed: sync.isSyncing ? null : _handleCloudSync,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),

            // بطاقة الاستعادة
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.restore, color: AppColors.lossRed),
                        SizedBox(width: 8),
                        Text('استعادة بيانات من نسخة سابقة', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'استرجع كافة بيانات المبيعات والمخزون والموردين من آخر نسخة احتياطية محلية محفوظة.',
                      style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 14),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.lossRed,
                        side: const BorderSide(color: AppColors.lossRed),
                      ),
                      icon: sync.isRestoring
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.lossRed))
                          : const Icon(Icons.folder_open, color: AppColors.lossRed),
                      label: Text(sync.isRestoring ? 'جارٍ الاستعادة...' : 'استيراد واستعادة من ملف محلي'),
                      onPressed: sync.isRestoring ? null : _showRestoreConfirmDialog,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
