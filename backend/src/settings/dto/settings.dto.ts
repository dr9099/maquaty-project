import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CostingMethod, Currency } from '@prisma/client';

export class UpdateStoreSettingsDto {
  @IsOptional()
  @IsEnum(Currency, { message: 'العملة يجب أن تكون YER أو SAR أو USD.' })
  currency?: Currency;

  @IsOptional()
  @IsEnum(CostingMethod, {
    message: 'طريقة احتساب التكلفة يجب أن تكون WEIGHTED_AVERAGE أو LAST_PRICE أو FIFO.',
  })
  defaultCostingMethod?: CostingMethod;

  @IsOptional()
  @IsBoolean({ message: 'خيار صلاحية المشتريات للعامل المسؤول يجب أن يكون قيمة منطقية.' })
  allowResponsiblePurchases?: boolean;

  @IsOptional()
  @IsString({ message: 'اسم المتجر يجب أن يكون نصاً.' })
  @MinLength(2, { message: 'اسم المتجر قصير جداً.' })
  @MaxLength(120, { message: 'اسم المتجر طويل جداً.' })
  storeName?: string;
}
