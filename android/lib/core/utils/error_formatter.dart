import '../network/api_client.dart';

/// تنسيق وعرض الأخطاء للمستخدم بصيغة عربية واضحة ومفهومة
/// وتفادي تسريب الاستثناءات التقنية والإنجليزية (Technical Exceptions) لواجهات المستخدم
String formatUserError(
  dynamic error, {
  String fallback = 'حدث خطأ غير متوقع، يرجى التحقق من الاتصال والمحاولة مرة أخرى.',
}) {
  if (error == null) return fallback;

  // القاعدة أ (Rule A): استثناءات الـ API تحمل رسائل الأعمال المعتمدة بالعربية
  if (error is ApiException) {
    if (error.message.trim().isNotEmpty) {
      return error.message.trim();
    }
    return fallback;
  }

  String msg = error.toString().trim();

  // إزالة بادئة Exception: إن وُجدت
  if (msg.startsWith('Exception: ')) {
    msg = msg.substring('Exception: '.length).trim();
  }

  // القاعدة ب (Rule B): فحص الاستثناءات التقنية الإنجليزية غير المعربة
  const technicalSignatures = [
    'SocketException',
    'DioException',
    'FormatException',
    'HttpException',
    'PlatformException',
    'FileSystemException',
    'TimeoutException',
    'DatabaseException',
    'SqfliteDatabaseException',
    'TypeError',
    'NoSuchMethodError',
    'NullThrownError',
  ];

  final isTechnical = technicalSignatures.any((sig) => msg.contains(sig));
  final hasArabic = RegExp(r'[\u0600-\u06FF]').hasMatch(msg);

  if (isTechnical || !hasArabic) {
    return fallback;
  }

  return msg;
}

