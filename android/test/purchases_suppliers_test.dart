import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:muqawati_app/core/network/api_client.dart';
import 'package:muqawati_app/data/models/auth_account.dart';
import 'package:muqawati_app/presentation/providers/daily_closing_provider.dart';
import 'package:muqawati_app/presentation/providers/inventory_provider.dart';
import 'package:muqawati_app/presentation/providers/purchases_provider.dart';
import 'package:muqawati_app/presentation/providers/store_settings_provider.dart';
import 'package:muqawati_app/presentation/providers/suppliers_provider.dart';
import 'package:muqawati_app/presentation/screens/purchases/create_purchase_screen.dart';

void main() {
  group('العملة الموحدة وصلاحيات العامل المسؤول وسياسة التكلفة (StoreSettingsProvider)', () {
    test('رموز العملات الموحدة وقفل تغيير العملة وزر صلاحيات المشتريات للعامل المسؤول (افتراضياً: منع)', () {
      final provider = StoreSettingsProvider(ApiClient());
      expect(provider.currency, 'YER');
      expect(provider.currencySymbol, 'ر.ي');
      expect(provider.currencyLocked, false);
      expect(provider.allowResponsiblePurchases, false);

      provider.applyFromJson({
        'store_name': 'متجر همدان',
        'currency': 'SAR',
        'currency_symbol': 'ر.س',
        'currency_name_ar': 'ريال سعودي',
        'currency_locked': true,
        'default_costing_method': 'FIFO',
        'allow_responsible_purchases': true,
      });

      expect(provider.currency, 'SAR');
      expect(provider.currencySymbol, 'ر.س');
      expect(provider.currencyLocked, true);
      expect(provider.defaultCostingMethod, 'FIFO');
      expect(provider.allowResponsiblePurchases, true);
      expect(StoreSettingsProvider.symbolForCurrency('USD'), '\$');
    });

    test('حساب AuthAccount يحفظ حالة السماح بالمشتريات للعامل المسؤول (افتراضياً false)', () {
      final respDefault = AuthAccount(
        id: 'w-resp-1',
        phone: '777000111',
        displayName: 'أمين المسؤول',
        storeName: 'مقوت الصباحي',
        role: 'WORKER',
        isResponsibleWorker: true,
        accessToken: 'tok',
        refreshToken: 'ref',
        lastActiveAt: DateTime(2026, 10, 30),
      );
      expect(respDefault.allowResponsiblePurchases, false);

      final respEnabled = respDefault.copyWith(allowResponsiblePurchases: true);
      expect(respEnabled.allowResponsiblePurchases, true);
      expect(
        AuthAccount.fromJson(respEnabled.toJson()).allowResponsiblePurchases,
        true,
      );
    });
  });

  group('وحدات البيع والتجزئة (كيلو / نصف كيلو / ربع كيلو مقابل حبة / ربطة / حزمة / مخصصة)', () {
    test('يميز وحدات الوزن القابلة للتجزئة عن الوحدات العددية غير القابلة للكسر', () {
      final kiloItem = ItemModel(
        id: '1',
        name: 'قات نوع A',
        unit: 'كيلو',
        quantity: 20,
        sellPrice: 20000,
      );
      expect(kiloItem.isWeightUnit, true);
      expect(kiloItem.isKiloUnit, true);
      // 1 كيلو = 20,000 | نصف كيلو = 10,000 | ربع كيلو = 5,000
      expect(kiloItem.sellPrice * 1.0, 20000.0);
      expect(kiloItem.sellPrice * 0.5, 10000.0);
      expect(kiloItem.sellPrice * 0.25, 5000.0);

      for (final discreteUnit in ['حبة', 'ربطة', 'حزمة', 'علاقي مخصص']) {
        final discreteItem = ItemModel(
          id: '2',
          name: 'قات نوع B',
          unit: discreteUnit,
          quantity: 15,
          sellPrice: 5000,
        );
        expect(discreteItem.isWeightUnit, false);
        expect(discreteItem.isKiloUnit, false);
      }
    });
  });

  group('محرك احتساب تكلفة المشتريات وقواعد القات 24-48 ساعة (CostingCalculator)', () {
    final day1 = DateTime(2026, 10, 29);
    final day2 = DateTime(2026, 10, 30);

    test('يرصد تعارض السعر فقط في نفس اليوم مع وجود كمية متبقية > 0', () {
      // نفس اليوم + كمية متبقية + سعر مختلف => تعارض (يعرض النافذة المنبثقة)
      expect(
        CostingCalculator.hasSameDayPriceConflict(
          existingQty: 10,
          existingCost: 4000,
          existingEntryDate: day1,
          newUnitCost: 5000,
          invoiceDate: day1,
        ),
        true,
      );

      // مخزون نافد (0) أو تالف => يُعتمد السعر الجديد تلقائياً دون نافذة
      expect(
        CostingCalculator.hasSameDayPriceConflict(
          existingQty: 0,
          existingCost: 4000,
          existingEntryDate: day1,
          newUnitCost: 5000,
          invoiceDate: day1,
        ),
        false,
      );

      // يوم جديد => يُعتمد السعر الجديد تلقائياً دون نافذة
      expect(
        CostingCalculator.hasSameDayPriceConflict(
          existingQty: 8,
          existingCost: 4000,
          existingEntryDate: day1,
          newUnitCost: 5500,
          invoiceDate: day2,
        ),
        false,
      );
    });

    test('يحسب الطرق الثلاث (المتوسط المرجح، السعر الأخير، FIFO) بدقة مالية', () {
      // 1) المتوسط المرجح المتحرك: (10*4000 + 10*5000) / 20 = 4500
      final weighted = CostingCalculator.computeUpdatedUnitCost(
        method: 'WEIGHTED_AVERAGE',
        existingQty: 10,
        existingCost: 4000,
        existingEntryDate: day1,
        addedBaseQty: 10,
        newBaseUnitCost: 5000,
        invoiceDate: day1,
      );
      expect(weighted, 4500.0);

      // 2) سعر الشراء الأخير: 5000
      final lastPrice = CostingCalculator.computeUpdatedUnitCost(
        method: 'LAST_PRICE',
        existingQty: 10,
        existingCost: 4000,
        existingEntryDate: day1,
        addedBaseQty: 10,
        newBaseUnitCost: 5000,
        invoiceDate: day1,
      );
      expect(lastPrice, 5000.0);

      // 3) الوارد أولاً صادر أولاً (FIFO): يبقي تكلفة الدفعة الأقدم نشطة حتى تنفد ثم يحسب COGS الطبقات
      final fifoActiveCost = CostingCalculator.computeUpdatedUnitCost(
        method: 'FIFO',
        existingQty: 5,
        existingCost: 4000,
        existingEntryDate: day1,
        addedBaseQty: 10,
        newBaseUnitCost: 5000,
        invoiceDate: day1,
      );
      expect(fifoActiveCost, 4000.0);

      // بيع 8 حبات بنظام FIFO: 5 من دفعة 4000 + 3 من دفعة 5000 = 20000 + 15000 = 35000
      final fifoCogs = CostingCalculator.computeFifoCogs(
        layers: [
          {'qty': 5.0, 'cost': 4000.0},
          {'qty': 10.0, 'cost': 5000.0},
        ],
        saleQty: 8.0,
      );
      expect(fifoCogs, 35000.0);
    });
  });

  group('صندوق اليوم المستقل (يبدأ من 0 ريال دائماً) ونماذج الفواتير', () {
    test('يحلل بيانات الإغلاق اليومي مع رصيد افتتاحي 0 وتفاصيل الحركات النقدية', () {
      final closing = DailyClosingData.fromJson({
        'closing_id': 'cls-1',
        'closing_date': '2026-10-30T00:00:00.000Z',
        'status': 'OPEN',
        'opening_cash': 0,
        'expected_cash': 42000,
        'actual_cash': 42000,
        'difference': 0,
        'summary': {
          'opening_cash': 0,
          'cash_sales': 50000,
          'cash_sale_returns': 3000,
          'cash_expenses': 5000,
        },
      });

      expect(closing.id, 'cls-1');
      expect(closing.openingCash, 0.0);
      expect(closing.expectedCash, 42000.0);
      expect(closing.summary['cash_sale_returns'], 3000);
    });

    test('تحويل وحدات الشراء والضرائب والخصومات في بند الشراء', () {
      const line = PurchaseLineInput(
        itemName: 'قات أرحبي ممتاز',
        unit: 'ربطة',
        baseUnit: 'حبة',
        conversionFactor: 10,
        quantity: 3, // 3 ربطات = 30 حبة
        unitCostPrice: 30000,
        taxAmount: 1500,
        discountAmount: 1500,
        sellPrice: 3800,
      );

      expect(line.baseQuantity, 30.0);
      expect(line.lineTotal, 90000.0);
      expect(line.effectiveBaseUnitCost, 3000.0);
    });

    test('رفض إنشاء فاتورة شراء تتجاوز 200 بند محلياً قبل إرسالها للخادم', () async {
      final prov = PurchasesProvider(ApiClient());
      final lines = List.generate(
        201,
        (i) => PurchaseLineInput(
          itemName: 'صنف $i',
          quantity: 1,
          unitCostPrice: 1000,
          sellPrice: 1200,
        ),
      );

      final res = await prov.createPurchase(
        supplierId: 'sup-1',
        paymentType: 'CASH',
        items: lines,
      );
      expect(res, isNull);
      expect(prov.errorCode, 'INVOICE_LINES_LIMIT_EXCEEDED');
    });

    test('تحليل بيانات كشف حساب المورد وأعمار الديون (Aging)', () {
      final aging = SupplierAgingData.fromJson({
        'total_outstanding': 120000,
        'buckets': {
          'days_0_30': 50000,
          'days_31_60': 40000,
          'days_61_90': 20000,
          'days_90_plus': 10000,
        },
        'open_items': [
          {'reference_number': 'PUR-20261029-0001', 'remaining_amount': 50000},
        ],
      });

      expect(aging.totalOutstanding, 120000.0);
      expect(aging.days0To30, 50000.0);
      expect(aging.days90Plus, 10000.0);
      expect(aging.openItems.length, 1);
    });
  });

  group('اختبار واجهة نافذة خيارات التكلفة بلهجة بيضاء واضحة (Widget Test)', () {
    testWidgets('تعرض التنبيه والخيارات الثلاثة بلهجة بيضاء واضحة وتعيد الخيار المحدد',
        (tester) async {
      String? pickedResult;

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: ElevatedButton(
                onPressed: () async {
                  pickedResult = await showSameDayCostingDialog(
                    context: context,
                    conflicts: const [
                      CostingConflictItem(
                        itemName: 'قات شامي',
                        baseUnit: 'كيلو',
                        existingQuantity: 5,
                        oldCostPrice: 15000,
                        newQuantity: 5,
                        newCostPrice: 17000,
                        weightedAveragePreview: 16000,
                      ),
                    ],
                    options: StoreSettingsProvider.defaultCostingOptions,
                    initialMethod: 'WEIGHTED_AVERAGE',
                    currencySymbol: 'ر.ي',
                  );
                },
                child: const Text('فتح النافذة'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('فتح النافذة'));
      await tester.pumpAndSettle();

      expect(
        find.text('تنبيه: هذا الصنف موجود من اليوم بسعر مختلف!'),
        findsOneWidget,
      );
      expect(
        find.textContaining('دمج الكميتين وحساب متوسط السعر تلقائياً'),
        findsOneWidget,
      );
      expect(
        find.textContaining('اعتماد السعر الجديد لكل الكمية الموجودة'),
        findsOneWidget,
      );
      expect(
        find.textContaining('بيع الكمية القديمة بسعرها أولاً ثم الجديدة بسعرها'),
        findsOneWidget,
      );

      await tester.tap(
        find.textContaining('اعتماد السعر الجديد لكل الكمية الموجودة'),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('اعتماد وحفظ الفاتورة'));
      await tester.pumpAndSettle();

      expect(pickedResult, 'LAST_PRICE');
    });
  });
}
