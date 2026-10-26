import 'package:flutter/material.dart';

/// لوحة الألوان الرسمية المعتمدة لنظام مَقوتي
/// المرجع: docs/09-mobile-app.md و design/screens/INDEX.md
class AppColors {
  // ألوان الهوية الرئيسية
  static const Color primary = Color(0xFF1C351D);        // أخضر داكن غابي (Forest Green)
  static const Color primaryDark = Color(0xFF0F1F12);    // أخضر أسود داكن جداً
  static const Color secondary = Color(0xFFB3CD7C);      // أخضر زيتوني فاتح (Olive Accent)
  static const Color accent = Color(0xFF8BAE55);         // درجة متناسقة للأزرار النشطة

  // الخلفيات والأسطح
  static const Color background = Color(0xFFF7FAF7);     // أبيض عاجي مخضر خفيف ومريح للعين
  static const Color surface = Colors.white;             // سطح البطاقات
  static const Color surfaceMuted = Color(0xFFEEF3EE);    // سطح ثانوي خفيف
  static const Color border = Color(0xFFDCE5DC);          // حدود الحقول والبطاقات

  // النصوص
  static const Color textPrimary = Color(0xFF1C351D);    // النص الأساسي
  static const Color textSecondary = Color(0xFF5D735E);  // النصوص الفرعية
  static const Color textMuted = Color(0xFF8E9E8F);      // التلميحات والأرقام الثانوية

  // الدلالات المالية والتشغيلية
  static const Color cashGreen = Color(0xFF2E7D32);      // نقد / مدفوعات
  static const Color electronicBlue = Color(0xFF1565C0); // دفع إلكتروني ومحافظ
  static const Color creditOrange = Color(0xFFE65100);   // آجل / ديون
  static const Color lossRed = Color(0xFFC62828);        // تالف / خسارة اضطرارية
  static const Color warning = Color(0xFFF57F17);        // تنبيهات وسقوف
}
