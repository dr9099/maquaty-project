import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../widgets/app_scaffold.dart';

/// شاشة النسخ الاحتياطي والاستعادة — الشاشات 23 و25 و30 (BACKUP_RESTORE / RESTORE_CONFIRM / BACKUP_PAYWALL_MODAL)
class BackupScreen extends StatefulWidget {
  const BackupScreen({super.key});

  @override
  State<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends State<BackupScreen> {
  bool _isCreatingBackup = false;

  void _createLocalBackup() async {
    setState(() => _isCreatingBackup = true);
    await Future.delayed(const Duration(seconds: 1));
    setState(() => _isCreatingBackup = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إنشاء وحفظ النسخة الاحتياطية المحلية بنجاح ✅')),
      );
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
            'استيراد هذه النسخة الاحتياطية سيستبدل كافة البيانات المحلية الحالية بالكامل ولا يمكن التراجع عن هذا الإجراء.\n\nهل أنت متأكد من الاستمرار؟',
            style: TextStyle(fontSize: 13),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.lossRed),
              onPressed: () {
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('تمت استعادة النسخة الاحتياطية بنجاح ✅')),
                );
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
    return AppScaffold(
      title: 'النسخ الاحتياطي والاستعادة',
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
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
                  const SizedBox(height: 14),
                  ElevatedButton.icon(
                    icon: _isCreatingBackup
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.download),
                    label: const Text('إنشاء نسخة محلية الآن'),
                    onPressed: _isCreatingBackup ? null : _createLocalBackup,
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
                    icon: const Icon(Icons.cloud_upload_outlined),
                    label: const Text('مزامنة سحابية الآن'),
                    onPressed: _showPaywallModal,
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
                    'اختر ملف نسخة احتياطية محلية لاسترجاع كافة المبيعات والمخزون والعملاء.',
                    style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: AppColors.lossRed, side: const BorderSide(color: AppColors.lossRed)),
                    icon: const Icon(Icons.folder_open, color: AppColors.lossRed),
                    label: const Text('استيراد واستعادة من ملف'),
                    onPressed: _showRestoreConfirmDialog,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
