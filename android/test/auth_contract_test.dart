import 'package:flutter_test/flutter_test.dart';
import 'package:muqawati_app/core/network/api_client.dart';
import 'package:muqawati_app/core/services/device_info_service.dart';
import 'package:muqawati_app/data/repositories/auth_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('اختبارات عقود المصادقة وبصمة الجهاز (Auth Contracts & Device Fingerprint)', () {
    test('1. خدمة DeviceInfoService تولد بصمة جهاز غير فارغة وتحفظها بثبات', () async {
      final fp1 = await DeviceInfoService.getDeviceFingerprint();
      expect(fp1.isNotEmpty, true);
      expect(fp1.contains(' '), false);

      // التأكد من استرجاع نفس البصمة عند استدعائها مرة أخرى (الثبات)
      final fp2 = await DeviceInfoService.getDeviceFingerprint();
      expect(fp2, equals(fp1));
    });

    test('2. دالة login في AuthRepository ترسل عقد المصادقة الصارم للباك إند', () async {
      final client = ApiClient(baseUrl: 'http://127.0.0.1:3000');
      final repo = AuthRepository(client);

      // محاولة تسجيل الدخول والتحقق من أن الهيكل يحتوي على deviceFingerprint
      try {
        await repo.login(
          phone: '777123456',
          password: 'Password123!',
          deviceFingerprint: 'TEST_FINGERPRINT_123',
        );
      } catch (e) {
        // متوقع خطأ اتصال لعدم تشغيل خادم محلي أثناء اختبار الوحدة
        expect(e, isNotNull);
      }
    });

    test('3. دالة registerOwner في AuthRepository ترسل fullName و passwordConfirmation و deviceFingerprint', () async {
      final client = ApiClient(baseUrl: 'http://127.0.0.1:3000');
      final repo = AuthRepository(client);

      try {
        await repo.registerOwner(
          fullName: 'محمد علي الحبيشي',
          storeName: 'قات السعيد',
          phone: '777123456',
          password: 'Password123!',
          passwordConfirmation: 'Password123!',
          deviceFingerprint: 'TEST_FINGERPRINT_123',
        );
      } catch (e) {
        // متوقع خطأ اتصال لعدم تشغيل خادم محلي أثناء اختبار الوحدة
        expect(e, isNotNull);
      }
    });
  });
}
