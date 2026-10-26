import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsNotEmpty,
  Min,
} from 'class-validator';
import { EmergencyPriceMode } from '@prisma/client';

export class CreateItemDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الصنف مطلوب.' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'وحدة القياس مطلوبة.' })
  unit!: string;

  @IsNumber()
  @IsPositive({ message: 'الكمية يجب أن تكون أكبر من صفر.' })
  quantity!: number;

  @IsNumber()
  @Min(0, { message: 'سعر الشراء لا يقبل سالباً أو صفراً.' })
  costPrice!: number;

  @IsNumber()
  @Min(0, { message: 'سعر البيع لا يقبل سالباً أو صفراً.' })
  sellPrice!: number;

  @IsOptional()
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
  @IsPositive()
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
