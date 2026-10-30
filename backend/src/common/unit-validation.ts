import { Prisma } from '@prisma/client';
import { ApiError } from './api-error';

const KILO_UNITS = new Set([
  'كيلو',
  'كجم',
  'كيلوغرام',
  'كيلوجرام',
  'kg',
  'kilo',
  'kilogram',
]);

const GRAM_UNITS = new Set([
  'جرام',
  'جم',
  'غم',
  'غ',
  'g',
  'gram',
  'grams',
]);

const WEIGHT_UNITS = new Set([
  ...KILO_UNITS,
  ...GRAM_UNITS,
  'لتر',
]);

export function isKiloUnit(unit?: string | null): boolean {
  if (!unit) return false;
  const normalized = unit.trim().toLowerCase();
  if (KILO_UNITS.has(normalized)) return true;
  return normalized.includes('كيلو');
}

export function isGramUnit(unit?: string | null): boolean {
  if (!unit) return false;
  const normalized = unit.trim().toLowerCase();
  return GRAM_UNITS.has(normalized);
}

export function isWeightUnit(unit?: string | null): boolean {
  if (!unit) return false;
  const normalized = unit.trim().toLowerCase();
  return isKiloUnit(normalized) || isGramUnit(normalized);
}

/**
 * يحدد ما إذا كانت الوحدة تقبل التجزئة الكسرية (مثل كيلو -> نصف كيلو 0.5 / ربع كيلو 0.25)
 * أم أنها وحدة عددية منفصلة (حبة، ربطة، حزمة، علاقية، وحدة مخصصة بالعدد) لا تقبل إلا أعداداً صحيحة.
 */
export function isFractionalUnitAllowed(unit: string): boolean {
  const normalized = (unit ?? '').trim().toLowerCase();
  if (!normalized) return false;
  if (WEIGHT_UNITS.has(normalized)) return true;
  if (normalized.includes('كيلو') || normalized.includes('وزن')) return true;
  return false;
}

export function assertValidQuantityForUnit(
  unit: string,
  quantity: Prisma.Decimal | number,
): void {
  if (isFractionalUnitAllowed(unit)) return;

  const numericQty =
    quantity instanceof Prisma.Decimal ? quantity.toNumber() : Number(quantity);

  // فحص العدد الصحيح بدقة مع تحمّل أخطاء الفاصلة العائمة الطفيفة
  if (Math.abs(numericQty - Math.round(numericQty)) > 1e-6) {
    throw ApiError.badRequest(
      'FRACTIONAL_QUANTITY_NOT_ALLOWED',
      `الصنف ذو الوحدة "${unit}" يُباع بالعدد الكامل فقط ولا يقبل كميات كسرية (مثل النصف أو الربع).`,
      { unit, requested_quantity: numericQty },
    );
  }
}
