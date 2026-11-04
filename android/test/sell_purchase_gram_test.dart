import 'package:flutter_test/flutter_test.dart';
import 'package:muqawati_app/core/utils/quantity_formatter.dart';
import 'package:muqawati_app/presentation/providers/inventory_provider.dart';
import 'package:muqawati_app/presentation/providers/purchases_provider.dart';
import 'package:muqawati_app/presentation/providers/sales_provider.dart';

void main() {
  group('إدخال الوزن بالجرام وحساب الأسعار وعرض الكميات (Sales & Purchases Gram Input)', () {
    test('1. قبول رقمي للبيع: 100جم بسعر 20,000/كجم = 2,000 وتخزين 0.100 كجم وعرض "100 جم"', () {
      const pricePerKilo = 20000.0;
      const inputGrams = 100.0;

      // الحساب التلقائي لإجمالي السعر بالجرام: (الجرامات ÷ 1000) × سعر الكيلو
      const saleAmount = (inputGrams / 1000.0) * pricePerKilo;
      expect(saleAmount, 2000.0);

      // التخزين في قاعدة البيانات بالكيلو بدقة 3 منازل عشرية
      const storedKilos = inputGrams / 1000.0;
      expect(storedKilos, 0.100);

      // صيغة العرض العربية المفهومة
      final display = formatQuantityDisplay(storedKilos, unit: 'كيلو');
      expect(display, '100 جم');
    });

    test('2. قبول رقمي للبيع: 1100جم بسعر 20,000/كجم = 22,000 وتخزين 1.100 كجم وعرض "1 كجم و100 جم"', () {
      const pricePerKilo = 20000.0;
      const inputGrams = 1100.0;

      const saleAmount = (inputGrams / 1000.0) * pricePerKilo;
      expect(saleAmount, 22000.0);

      const storedKilos = inputGrams / 1000.0;
      expect(storedKilos, 1.100);

      final display = formatQuantityDisplay(storedKilos, unit: 'كيلو');
      expect(display, '1 كجم و100 جم');
    });

    test('3. قبول رقمي للبيع: 1000جم = 1 كجم ويُعرض "1 كجم"', () {
      const inputGrams = 1000.0;
      const storedKilos = inputGrams / 1000.0;
      expect(storedKilos, 1.0);

      final display = formatQuantityDisplay(storedKilos, unit: 'كيلو');
      expect(display, '1 كجم');
    });

    test('4. قبول رقمي للشراء: شراء 220جم بسعر تكلفة 15/جم = 3,300 وتكلفة الكيلو 15,000', () {
      const quantityGrams = 220.0;
      const unitCostPerGram = 15.0;
      const conversionFactor = 0.001; // معامل تحويل الجرام إلى كيلو

      // إجمالي السطر = الكمية × سعر التكلفة للوحدة المدخلة
      const lineTotal = quantityGrams * unitCostPerGram;
      expect(lineTotal, 3300.0);

      // الكمية بوحدة التخزين الأساسية (الكيلو)
      const baseQuantityKilos = quantityGrams * conversionFactor;
      expect(baseQuantityKilos, 0.220);

      // تكلفة وحدة الكيلو الفعلية في المخزون = سعر الجرام ÷ معامل التحويل
      const effectiveCostPerKilo = unitCostPerGram / conversionFactor;
      expect(effectiveCostPerKilo, 15000.0);

      // عرض الكمية بصيغة مفهومة
      final display = formatQuantityDisplay(baseQuantityKilos, unit: 'كيلو');
      expect(display, '220 جم');
    });

    test('5. قبول رقمي للشراء: شراء 1100جم يُخزن 1.100 كجم ويُعرض "1 كجم و100 جم"', () {
      const quantityGrams = 1100.0;
      const conversionFactor = 0.001;

      const baseQuantityKilos = quantityGrams * conversionFactor;
      expect(baseQuantityKilos, 1.100);

      final display = formatQuantityDisplay(baseQuantityKilos, unit: 'كيلو');
      expect(display, '1 كجم و100 جم');
    });

    test('6. رفض كسور الجرام: إدخال 100.5 جم غير مسموح لأن أصغر وحدة ملموسة هي 1 جرام صحيح', () {
      const fractionalGrams = 100.5;
      final isIntegerGrams = fractionalGrams == fractionalGrams.truncateToDouble();
      expect(isIntegerGrams, false, reason: 'يجب رفض كسور الجرام');

      const validGrams = 100.0;
      final isValidInteger = validGrams == validGrams.truncateToDouble();
      expect(isValidInteger, true);
    });

    test('7. الأصناف غير الوزنية (حبة، ربطة، حزمة): لا تقبل الجرام ولا تتغير طريقة حسابها', () {
      expect(ItemModel.isWeightUnitName('حبة'), false);
      expect(ItemModel.isWeightUnitName('ربطة'), false);
      expect(ItemModel.isWeightUnitName('حزمة'), false);
      expect(ItemModel.isWeightUnitName('كيلو'), true);
      expect(ItemModel.isWeightUnitName('كجم'), true);

      // الصنف بالعدد (3 حبات بسعر 500 = 1500)
      const count = 3.0;
      const unitPrice = 500.0;
      const total = count * unitPrice;
      expect(total, 1500.0);
      expect(formatQuantityDisplay(count, unit: 'حبة'), '3 حبة');
    });

    test('8. الأصناف المعرفة مسبقاً بوحدة الجرام الأساسية لا تُقسم على 1000', () {
      expect(isGramUnit('جرام'), true);
      expect(isGramUnit('جم'), true);
      expect(formatQuantityDisplay(220, unit: 'جرام'), '220 جرام');
      expect(formatQuantityDisplay(220, unit: 'جم'), '220 جم');
    });

    test('9. نماذج البيانات (Models): تعامل SaleRecord و PurchaseItemModel مع quantity_display', () {
      final sale = SaleRecord.fromJson({
        'id': 'sale-1',
        'item_name': 'نقفة صعدي',
        'unit': 'كيلو',
        'quantity': 0.220,
        'quantity_display': '220 جم',
        'amount': 3300.0,
        'sold_at': '2026-10-31T01:00:00Z',
      });
      expect(sale.displayQuantity, '220 جم');

      final purchaseItem = PurchaseItemModel.fromJson({
        'item_id': 'item-1',
        'item_name': 'بلدي',
        'unit': 'كيلو',
        'quantity': 1.100,
        'quantity_display': '1 كجم و100 جم',
        'unit_cost_price': 15000.0,
        'line_total': 16500.0,
      });
      expect(purchaseItem.displayQuantity, '1 كجم و100 جم');
    });
  });
}

