import 'package:flutter_test/flutter_test.dart';
import 'package:muqawati_app/core/utils/quantity_formatter.dart';

void main() {
  group('Quantity Formatter (Flutter - تنسيق عرض كميات الوزن والأعداد)', () {
    test('1. 0.001 كيلو -> "1 جم"', () {
      expect(formatQuantityDisplay(0.001, unit: 'كيلو'), '1 جم');
      expect(formatQuantityDisplay('0.001', unit: 'كيلو'), '1 جم');
    });

    test('2. 0.220 كيلو -> "220 جم"', () {
      expect(formatQuantityDisplay(0.220, unit: 'كيلو'), '220 جم');
      expect(formatQuantityDisplay(0.22, unit: 'كجم'), '220 جم');
    });

    test('3. 0.999 كيلو -> "999 جم"', () {
      expect(formatQuantityDisplay(0.999, unit: 'كيلو'), '999 جم');
    });

    test('4. 1.000 كيلو -> "1 كجم"', () {
      expect(formatQuantityDisplay(1, unit: 'كيلو'), '1 كجم');
      expect(formatQuantityDisplay(1.0, unit: 'كيلو'), '1 كجم');
      expect(formatQuantityDisplay('1.000', unit: 'كيلو'), '1 كجم');
    });

    test('5. 1.001 كيلو -> "1 كجم و1 جم"', () {
      expect(formatQuantityDisplay(1.001, unit: 'كيلو'), '1 كجم و1 جم');
      expect(formatQuantityDisplay(1.001, unit: 'كجم'), '1 كجم و1 جم');
    });

    test('6. 1.100 كيلو -> "1 كجم و100 جم"', () {
      expect(formatQuantityDisplay(1.1, unit: 'كيلو'), '1 كجم و100 جم');
      expect(formatQuantityDisplay(1.100, unit: 'كيلو'), '1 كجم و100 جم');
    });

    test('7. 5.500 كيلو -> "5 كجم و500 جم"', () {
      expect(formatQuantityDisplay(5.5, unit: 'كيلو'), '5 كجم و500 جم');
      expect(formatQuantityDisplay(5.500, unit: 'كيلو'), '5 كجم و500 جم');
    });

    test('8. 0 كيلو -> "0 جم"', () {
      expect(formatQuantityDisplay(0, unit: 'كيلو'), '0 جم');
      expect(formatQuantityDisplay(0.0, unit: 'كيلو'), '0 جم');
    });

    test('9. 3 حبة -> "3 حبة" (وحدة عددية منفصلة لا تحول إلى جرامات)', () {
      expect(formatQuantityDisplay(3, unit: 'حبة'), '3 حبة');
      expect(formatQuantityDisplay(10, unit: 'ربطة'), '10 ربطة');
      expect(formatQuantityDisplay(5, unit: 'حزمة'), '5 حزمة');
    });

    test('10. صنف وحدته الأساسية جرام: 220 جرام -> "220 جرام" / 220 جم -> "220 جم"', () {
      expect(formatQuantityDisplay(220, unit: 'جرام'), '220 جرام');
      expect(formatQuantityDisplay(220, unit: 'جم'), '220 جم');
      expect(formatQuantityDisplay(500, unit: 'جرام'), '500 جرام');
    });

    test('Edge cases: القيم الافتراضية والسالبة', () {
      expect(formatQuantityDisplay(0.220), '220 جم');
      expect(formatQuantityDisplay(-0.220, unit: 'كيلو'), '-220 جم');
      expect(formatQuantityDisplay(-1.500, unit: 'كيلو'), '-1 كجم و500 جم');
      expect(formatQuantityDisplay(null), '');
      expect(formatQuantityDisplay('invalid'), '0 جم');
    });
  });
}
