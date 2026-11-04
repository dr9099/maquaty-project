import { Prisma } from '@prisma/client';
import { formatQuantityDisplay } from '../src/common/quantity-formatter';

describe('Quantity Formatter (تنسيق عرض كميات الوزن والأعداد)', () => {
  describe('Golden Vectors (المتجهات الذهبية المعيارية)', () => {
    it('1. 0.001 كيلو -> "1 جم"', () => {
      expect(formatQuantityDisplay(0.001, 'كيلو')).toBe('1 جم');
      expect(formatQuantityDisplay(new Prisma.Decimal('0.001'), 'كيلو')).toBe('1 جم');
      expect(formatQuantityDisplay('0.001', 'كيلو')).toBe('1 جم');
    });

    it('2. 0.220 كيلو -> "220 جم"', () => {
      expect(formatQuantityDisplay(0.220, 'كيلو')).toBe('220 جم');
      expect(formatQuantityDisplay(new Prisma.Decimal('0.220'), 'كجم')).toBe('220 جم');
    });

    it('3. 0.999 كيلو -> "999 جم"', () => {
      expect(formatQuantityDisplay(0.999, 'كيلو')).toBe('999 جم');
      expect(formatQuantityDisplay(new Prisma.Decimal('0.999'), 'كيلو')).toBe('999 جم');
    });

    it('4. 1.000 كيلو -> "1 كجم"', () => {
      expect(formatQuantityDisplay(1, 'كيلو')).toBe('1 كجم');
      expect(formatQuantityDisplay(1.0, 'كيلو')).toBe('1 كجم');
      expect(formatQuantityDisplay(new Prisma.Decimal('1.000'), 'كيلو')).toBe('1 كجم');
    });

    it('5. 1.001 كيلو -> "1 كجم و1 جم"', () => {
      expect(formatQuantityDisplay(1.001, 'كيلو')).toBe('1 كجم و1 جم');
      expect(formatQuantityDisplay(new Prisma.Decimal('1.001'), 'كجم')).toBe('1 كجم و1 جم');
    });

    it('6. 1.100 كيلو -> "1 كجم و100 جم"', () => {
      expect(formatQuantityDisplay(1.1, 'كيلو')).toBe('1 كجم و100 جم');
      expect(formatQuantityDisplay(1.100, 'كيلو')).toBe('1 كجم و100 جم');
      expect(formatQuantityDisplay(new Prisma.Decimal('1.100'), 'كيلو')).toBe('1 كجم و100 جم');
    });

    it('7. 5.500 كيلو -> "5 كجم و500 جم"', () => {
      expect(formatQuantityDisplay(5.5, 'كيلو')).toBe('5 كجم و500 جم');
      expect(formatQuantityDisplay(new Prisma.Decimal('5.500'), 'كيلو')).toBe('5 كجم و500 جم');
    });

    it('8. 0 كيلو -> "0 جم"', () => {
      expect(formatQuantityDisplay(0, 'كيلو')).toBe('0 جم');
      expect(formatQuantityDisplay(new Prisma.Decimal('0'), 'كيلو')).toBe('0 جم');
    });

    it('9. 3 حبة -> "3 حبة" (وحدة عددية منفصلة لا تحول إلى جرامات)', () => {
      expect(formatQuantityDisplay(3, 'حبة')).toBe('3 حبة');
      expect(formatQuantityDisplay(new Prisma.Decimal('3'), 'حبة')).toBe('3 حبة');
      expect(formatQuantityDisplay(10, 'ربطة')).toBe('10 ربطة');
      expect(formatQuantityDisplay(5, 'حزمة')).toBe('5 حزمة');
    });

    it('10. صنف وحدته الأساسية جرام: 220 جرام -> "220 جرام" / 220 جم -> "220 جم"', () => {
      expect(formatQuantityDisplay(220, 'جرام')).toBe('220 جرام');
      expect(formatQuantityDisplay(220, 'جم')).toBe('220 جم');
      expect(formatQuantityDisplay(new Prisma.Decimal('500'), 'جرام')).toBe('500 جرام');
    });
  });

  describe('Edge cases and Default behaviors', () => {
    it('عند إغفال الوحدة تعامل افتراضياً كوزن بالكيلو', () => {
      expect(formatQuantityDisplay(0.220)).toBe('220 جم');
      expect(formatQuantityDisplay(1.100)).toBe('1 كجم و100 جم');
      expect(formatQuantityDisplay(2)).toBe('2 كجم');
    });

    it('الكميات السالبة تظهر بإشارة سالب مناسبة', () => {
      expect(formatQuantityDisplay(-0.220, 'كيلو')).toBe('-220 جم');
      expect(formatQuantityDisplay(-1.500, 'كيلو')).toBe('-1 كجم و500 جم');
      expect(formatQuantityDisplay(-2, 'حبة')).toBe('-2 حبة');
    });

    it('القيم الفارغة وغير الصالحة ترجع سلسلة نصية فارغة', () => {
      expect(formatQuantityDisplay(null)).toBe('');
      expect(formatQuantityDisplay(undefined)).toBe('');
      expect(formatQuantityDisplay('invalid')).toBe('');
    });
  });
});

