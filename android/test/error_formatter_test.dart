import 'package:flutter_test/flutter_test.dart';
import 'package:muqawati_app/core/network/api_client.dart';
import 'package:muqawati_app/core/utils/error_formatter.dart';

void main() {
  group('اختبارات منسق أخطاء واجهة المستخدم (error_formatter)', () {
    test('القاعدة أ: استثناءات ApiException تعيد رسالة الخطأ المحددة بالعربية دائماً', () {
      final apiErr = ApiException(
        code: 'INSUFFICIENT_STOCK',
        message: 'الكمية غير كافية في المخزون الحالي.',
      );
      expect(formatUserError(apiErr), 'الكمية غير كافية في المخزون الحالي.');
    });

    test('القاعدة ب: استثناءات DioException والشبكة الإنجليزية تعيد الرسالة العربية البديلة', () {
      const rawError = 'DioException [connection timeout]: The request connection took longer than 0:00:10.000000';
      expect(
        formatUserError(rawError),
        'حدث خطأ غير متوقع، يرجى التحقق من الاتصال والمحاولة مرة أخرى.',
      );
    });

    test('القاعدة ب: استثناءات SocketException وFormatException تعيد الرسالة العربية البديلة', () {
      expect(
        formatUserError('SocketException: OS Error: Connection refused, errno = 111'),
        'حدث خطأ غير متوقع، يرجى التحقق من الاتصال والمحاولة مرة أخرى.',
      );
      expect(
        formatUserError('FormatException: Unexpected character (at character 1)'),
        'حدث خطأ غير متوقع، يرجى التحقق من الاتصال والمحاولة مرة أخرى.',
      );
    });

    test('الاستثناءات التي تحتوي مسبقاً على نص عربي تزيل بادئة Exception وتعرض النص العربي', () {
      final customErr = Exception('رصيد العميل تجاوز الحد المسموح.');
      expect(formatUserError(customErr), 'رصيد العميل تجاوز الحد المسموح.');
    });

    test('القيم الفارغة (null) تعيد الرسالة الافتراضية البديلة', () {
      expect(
        formatUserError(null),
        'حدث خطأ غير متوقع، يرجى التحقق من الاتصال والمحاولة مرة أخرى.',
      );
    });
  });
}
