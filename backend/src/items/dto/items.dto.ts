import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsNotEmpty,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CostingMethod, EmergencyPriceMode } from '@prisma/client';

function normalizeEmergencyMode(value: unknown): unknown {
  if (value === 'MANUAL_RANGE' || value === 'OPEN') return 'RANGE_OR_OPEN';
  return value;
}

export class CreateItemDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الصنف مطلوب.' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'وحدة القياس مطلوبة.' })
  unit!: string;

  @IsNumber()
  @Min(0, { message: 'الكمية لا تقبل رقماً سالباً.' })
  quantity!: number;

  @IsNumber()
  @Min(0, { message: 'سعر الشراء لا يقبل سالباً أو صفراً.' })
  costPrice!: number;

  @IsNumber()
  @Min(0, { message: 'سعر البيع لا يقبل سالباً أو صفراً.' })
  sellPrice!: number;

  @IsOptional()
  @Transform(({ value }) => normalizeEmergencyMode(value))
  @IsEnum(EmergencyPriceMode, { message: 'نمط سياسة البيع الاضطراري غير صالح.' })
  emergencyPriceMode?: EmergencyPriceMode;

  @IsOptional()
  @IsNumber()
  emergencyPricePlusFixed?: number;

  @IsOptional()
  @IsNumber()
  emergencyPricePlusPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emergencyPriceMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emergencyPriceMax?: number;

  @IsOptional()
  @IsEnum(CostingMethod, {
    message: 'طريقة احتساب التكلفة يجب أن تكون WEIGHTED_AVERAGE أو LAST_PRICE أو FIFO.',
  })
  costingMethod?: CostingMethod;

  @IsOptional()
  @IsBoolean()
  promptOnSameDayPriceDiff?: boolean;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeEmergencyMode(value))
  @IsEnum(EmergencyPriceMode)
  emergencyPriceMode?: EmergencyPriceMode;

  @IsOptional()
  @IsNumber()
  emergencyPricePlusFixed?: number;

  @IsOptional()
  @IsNumber()
  emergencyPricePlusPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emergencyPriceMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emergencyPriceMax?: number;
}
