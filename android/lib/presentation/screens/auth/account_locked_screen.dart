import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_colors.dart';
import '../../providers/auth_provider.dart';

/// شاشة قفل الحساب — الشاشة 24 (ACCOUNT_LOCKED / 24-account-locked.jpg)
class AccountLockedScreen extends StatelessWidget {
  final String? lockReason;
  const AccountLockedScreen({super.key, this.lockReason});

  static const String supportPhone = '735717710';

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final reasonText = lockReason ??
        auth.lockReason ??
        'انتهت فترة التجربة المجانية لمتجرك. للاستمرار في استخدام مَقوتي وحفظ كافة بياناتك ومبيعاتك، يرجى الاشتراك وتجديد الحساب.';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: AppColors.lossRed.withOpacity(0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.lock_outline,
                      size: 44,
                      color: AppColors.lossRed,
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'انتهت صلاحية الوصول',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    reasonText,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppColors.textSecondary,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 28),

                  // بطاقة رقم التواصل والدعم
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      children: [
                        const Text(
                          'للتجديد والاشتراك تواصل مع إدارة مَقوتي:',
                          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Text(
                              supportPhone,
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: AppColors.primary,
                                letterSpacing: 1.5,
                              ),
                            ),
                            const SizedBox(width: 8),
                            IconButton(
                              icon: const Icon(Icons.copy, size: 20, color: AppColors.primary),
                              tooltip: 'نسخ الرقم',
                              onPressed: () {
                                Clipboard.setData(const ClipboardData(text: supportPhone));
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('تم نسخ رقم الدعم بنجاح ✅')),
                                );
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // زر تواصل عبر واتساب
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.cashGreen,
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                    ),
                    icon: const Icon(Icons.chat_outlined),
                    label: const Text('تواصل عبر واتساب'),
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('فتح محادثة واتساب مع الدعم الفني: 735717710')),
                      );
                    },
                  ),
                  const SizedBox(height: 12),

                  // زر تسجيل الخروج
                  TextButton(
                    onPressed: () async {
                      await auth.logout();
                      if (context.mounted) {
                        Navigator.pushNamedAndRemoveUntil(context, '/login', (r) => false);
                      }
                    },
                    child: const Text(
                      'تسجيل الخروج والتبديل لحساب آخر',
                      style: TextStyle(color: AppColors.lossRed, fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
