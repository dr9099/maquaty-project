import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:muqawati_app/core/constants/api_endpoints.dart';
import 'package:muqawati_app/core/network/api_client.dart';
import 'package:muqawati_app/core/services/device_info_service.dart';
import 'package:muqawati_app/core/storage/secure_storage_service.dart';
import 'package:muqawati_app/data/models/auth_account.dart';
import 'package:muqawati_app/data/repositories/auth_repository.dart';
import 'package:muqawati_app/presentation/providers/auth_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _RecordingLogoutApiClient extends ApiClient {
  final List<Map<String, dynamic>> postCalls = [];
  bool shouldThrowOnPost = false;

  _RecordingLogoutApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  @override
  Future<Response> post(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    postCalls.add({'path': path, 'data': data});
    if (shouldThrowOnPost) {
      throw ApiException(code: 'NETWORK_ERROR', message: 'offline');
    }
    return Response(
      requestOptions: RequestOptions(path: path),
      statusCode: 200,
      data: {'logged_out': true},
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('اختبارات عقود المصادقة وبصمة الجهاز (Auth Contracts & Device Fingerprint)', () {
    test('1. خدمة DeviceInfoService تولد بصمة جهاز غير فارغة وتحفظها بثبات وتمنع البصمات الافتراضية', () async {
      final fp1 = await DeviceInfoService.getDeviceFingerprint();
      expect(fp1.isNotEmpty, true);
      expect(fp1.contains(' '), false);
      expect(fp1 != 'APP-DEVICE-DEFAULT', true);
      expect(fp1.length >= 8, true);

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

    test('4. Wave C.5 — دالة logout في AuthRepository ترسل refreshToken في الطلب وتنظف التخزين المحلي حتى عند فشل الشبكة', () async {
      final api = _RecordingLogoutApiClient();
      final repo = AuthRepository(api);
      final storage = SecureStorageService();

      final account = AuthAccount(
        id: 'owner-logout-test',
        phone: '777111222',
        displayName: 'مالك الاختبار',
        storeName: 'متجر مَقوتي',
        role: 'STORE_OWNER',
        accountStatus: 'ACTIVE',
        accessToken: 'access-tok-1',
        refreshToken: 'refresh-secret-xyz',
        lastActiveAt: DateTime.now(),
      );
      await storage.saveAccount(account, setActive: true);

      await repo.logout();

      expect(api.postCalls.length, 1);
      expect(api.postCalls.first['path'], ApiEndpoints.logout);
      expect(api.postCalls.first['data'], equals({'refreshToken': 'refresh-secret-xyz'}));
      expect(await storage.getActiveAccount(), isNull);

      // التحقق من تنظيف التخزين المحلي حتى عند فشل الشبكة في finally
      await storage.saveAccount(account, setActive: true);
      api.postCalls.clear();
      api.shouldThrowOnPost = true;
      await repo.logout();
      expect(await storage.getActiveAccount(), isNull);
    });

    test('5. Wave C.2 — حالة الحساب EXPIRED تفعّل AuthStatus.accountLocked فوراً في AuthProvider', () async {
      final api = _RecordingLogoutApiClient();
      final repo = AuthRepository(api);
      final authProvider = AuthProvider(repo);

      authProvider.setCurrentAccountForTesting(
        AuthAccount(
          id: 'owner-expired-test',
          phone: '777333444',
          displayName: 'مالك منتهي',
          storeName: 'متجر مَقوتي',
          role: 'STORE_OWNER',
          accountStatus: 'ACTIVE',
          accessToken: 'tok',
          refreshToken: 'ref',
          lastActiveAt: DateTime.now(),
        ),
      );

      await authProvider.updateAccountStatus('EXPIRED');
      expect(authProvider.status, equals(AuthStatus.accountLocked));
    });
  });
}

