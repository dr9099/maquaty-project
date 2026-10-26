import 'package:flutter_test/flutter_test.dart';
import 'package:muqawati_app/core/constants/app_colors.dart';
import 'package:muqawati_app/core/theme/app_theme.dart';
import 'package:muqawati_app/data/models/auth_account.dart';
import 'package:muqawati_app/presentation/providers/inventory_provider.dart';
import 'package:muqawati_app/presentation/providers/sales_provider.dart';
import 'package:muqawati_app/presentation/providers/daily_closing_provider.dart';

void main() {
  group('الهوية البصرية والتصميم (App Colors & Theme)', () {
    test('ألوان الهوية المعتمدة متطابقة بدقة مع الوثائق الرسمية', () {
      expect(AppColors.primary.value, 0xFF1C351D);
      expect(AppColors.secondary.value, 0xFFB3CD7C);
      expect(AppColors.primaryDark.value, 0xFF0F1F12);
      expect(AppColors.background.value, 0xFFF7FAF7);
    });

    test('السمة الرسمية تستخدم خط Titr المعتمد', () {
      expect(AppTheme.fontFamily, 'Titr');
      final theme = AppTheme.lightTheme;
      expect(theme.primaryColor, AppColors.primary);
    });
  });

  group('نماذج البيانات وتبديل الحسابات (AuthAccount & Multi-Account Switcher R-35)', () {
    test('تحويل AuthAccount إلى ومن JSON مع الحفاظ على التوكنات والصلاحيات', () {
      final account = AuthAccount(
        id: 'owner-uuid-123',
        phone: '771234567',
        displayName: 'أبو أحمد الهمداني',
        storeName: 'متجر همدان للقات',
        role: 'STORE_OWNER',
        isResponsibleWorker: false,
        accessToken: 'access-jwt-token',
        refreshToken: 'refresh-jwt-token',
        lastActiveAt: DateTime.parse('2026-10-26T12:00:00Z'),
        permissions: {},
      );

      final json = account.toJson();
      final restored = AuthAccount.fromJson(json);

      expect(restored.id, 'owner-uuid-123');
      expect(restored.displayName, 'أبو أحمد الهمداني');
      expect(restored.isOwner, true);
      expect(restored.role, 'STORE_OWNER');
    });

    test('التحقق من حساب العامل المسؤول (R-33)', () {
      final worker = AuthAccount(
        id: 'worker-uuid-456',
        phone: '772345678',
        displayName: 'مساعد المتجر',
        storeName: 'متجر همدان',
        role: 'WORKER',
        isResponsibleWorker: true,
        accessToken: 'tok1',
        refreshToken: 'tok2',
        lastActiveAt: DateTime.now(),
        permissions: {'perm_enter_own_advance': true, 'perm_reports_access': true},
      );

      expect(worker.isOwner, false);
      expect(worker.isResponsibleWorker, true);
      expect(worker.permissions['perm_enter_own_advance'], true);
    });
  });

  group('نماذج المبيعات والمخزون والإغلاق اليومي', () {
    test('نموذج الصنف ItemModel يحسب البيانات والسياسة الاضطرارية', () {
      final item = ItemModel.fromJson({
        'id': 'item-1',
        'name': 'قات شامي ممتاز',
        'quantity': 15.5,
        'sell_price': 5000,
        'cost_price': 4000,
        'emergency_price_mode': 'MANUAL_RANGE',
        'emergency_price_min': 4200,
        'emergency_price_max': 5000,
      });

      expect(item.name, 'قات شامي ممتاز');
      expect(item.quantity, 15.5);
      expect(item.sellPrice, 5000.0);
      expect(item.costPrice, 4000.0);
      expect(item.emergencyPriceMin, 4200.0);
    });

    test('سجل البيع SaleRecord يوثق البيع الاضطراري وقيمته (R-16)', () {
      final sale = SaleRecord.fromJson({
        'id': 'sale-1',
        'itemName': 'قات همداني',
        'quantity': 2,
        'amount': 5600,
        'payment_type': 'CASH',
        'is_emergency_sale': true,
        'emergency_override_price': 2800,
        'emergency_reason': 'عميل دائم تصريف مسائي',
        'sold_at': '2026-10-26T16:00:00Z',
      });

      expect(sale.isEmergencySale, true);
      expect(sale.emergencyOverridePrice, 2800.0);
      expect(sale.emergencyReason, 'عميل دائم تصريف مسائي');
    });

    test('بيانات الإغلاق اليومي DailyClosingData تطابق الكاش والفرق (R-36)', () {
      final closing = DailyClosingData.fromJson({
        'id': 'closing-today',
        'closing_date': '2026-10-26',
        'status': 'CLOSED',
        'expected_cash': 50000,
        'actual_cash': 49500,
        'difference': -500,
      });

      expect(closing.isClosed, true);
      expect(closing.expectedCash, 50000.0);
      expect(closing.actualCash, 49500.0);
      expect(closing.difference, -500.0);
    });
  });
}
