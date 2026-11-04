import { Prisma } from '@prisma/client';
import { isGramUnit, isKiloUnit } from './unit-validation';

/**
 * تنسيق عرض كمية الوزن بصيغة عربية مفهومة:
 * - للأصناف بالكيلو: '220 جم'، '1 كجم'، '1 كجم و100 جم' بدلاً من '0.220 كيلو' أو '1.1 كيلو'
 * - للأصناف التي وحدتها الأساسية بالجرام: تُعرض كما هي دون قسمة أو ضرب (مثل: '220 جرام')
 * - للوحدات العددية المنفصلة (حبة، ربطة، إلخ): تُعرض كما هي مع اسم الوحدة (مثل: '3 حبة')
 */
export function formatQuantityDisplay(
  quantity: number | Prisma.Decimal | string | null | undefined,
  unit?: string | null,
): string {
  if (quantity === null || quantity === undefined) {
    return '';
  }

  const num =
    quantity instanceof Prisma.Decimal
      ? quantity.toNumber()
      : typeof quantity === 'string'
        ? Number(quantity)
        : quantity;

  if (isNaN(num)) {
    return '';
  }

  const cleanUnit = (unit ?? '').trim();
  const isNegative = num < 0;
  const absNum = Math.abs(num);

  // 1. إذا كانت الوحدة الأساسية هي الجرام بالفعل: لا تحويل ولا قسمة بل تُعرض كما هي
  if (isGramUnit(cleanUnit)) {
    const formattedNum = Number.isInteger(absNum)
      ? absNum.toString()
      : Number(absNum.toFixed(3)).toString();
    const prefix = isNegative ? '-' : '';
    return cleanUnit ? `${prefix}${formattedNum} ${cleanUnit}` : `${prefix}${formattedNum}`;
  }

  // 2. إذا كانت الوحدة بالكيلو (أو افتراضية فارغة):
  if (isKiloUnit(cleanUnit) || cleanUnit === '') {
    const totalGrams = Math.round(absNum * 1000);
    const prefix = isNegative ? '-' : '';

    if (totalGrams === 0) {
      return '0 جم';
    }
    if (totalGrams < 1000) {
      return `${prefix}${totalGrams} جم`;
    }

    const kg = Math.floor(totalGrams / 1000);
    const remGrams = totalGrams % 1000;

    if (remGrams === 0) {
      return `${prefix}${kg} كجم`;
    }
    return `${prefix}${kg} كجم و${remGrams} جم`;
  }

  // 3. أي وحدة عددية أو منفصلة أخرى (حبة، ربطة، حزمة، لتر، وحدة مخصصة):
  const formattedNum = Number.isInteger(absNum)
    ? absNum.toString()
    : Number(absNum.toFixed(3)).toString();
  const prefix = isNegative ? '-' : '';
  return cleanUnit ? `${prefix}${formattedNum} ${cleanUnit}` : `${prefix}${formattedNum}`;
}

