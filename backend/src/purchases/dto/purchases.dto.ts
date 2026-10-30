import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CostingMethod,
  EmergencyPriceMode,
  PurchaseInvoiceStatus,
  PurchasePaymentType,
  PurchaseRefundMethod,
} from '@prisma/client';

export class PurchaseLineInputDto {
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الصنف غير صالح.' })
  itemId?: string;

  @IsString({ message: 'اسم الصنف مطلوب.' })
  @IsNotEmpty({ message: 'اسم الصنف مطلوب.' })
  @MaxLength(120)
  itemName: string;

  @IsString({ message: 'وحدة الشراء مطلوبة.' })
  @IsNotEmpty({ message: 'وحدة الشراء مطلوبة.' })
  @MaxLength(40)
  unit: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  baseUnit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'معامل التحويل يجب أن يكون رقماً.' })
  @Min(0.001, { message: 'معامل التحويل يجب أن يكون أكبر من صفر.' })
  conversionFactor?: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً.' })
  @Min(0.001, { message: 'الكمية يجب أن تكون أكبر من صفر.' })
  quantity: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'سعر شراء الوحدة يجب أن يكون رقماً.' })
  @Min(0, { message: 'سعر شراء الوحدة لا يمكن أن يكون سالباً.' })
  unitCostPrice: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'ضريبة البند لا يمكن أن تكون سالبة.' })
  taxAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'خصم البند لا يمكن أن يكون سالباً.' })
  discountAmount?: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'سعر البيع للوحدة الأساسية مطلوب.' })
  @Min(0, { message: 'سعر البيع لا يمكن أن يكون سالباً.' })
  sellPrice: number;

  @IsOptional()
  @IsEnum(EmergencyPriceMode)
  emergencyPriceMode?: EmergencyPriceMode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  emergencyPricePlusFixed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  emergencyPricePlusPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  emergencyPriceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  emergencyPriceMax?: number;
}

export class CreatePurchaseDto {
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الفاتورة غير صالح.' })
  id?: string;

  @IsUUID('4', { message: 'معرّف المورد مطلوب وبصيغة صحيحة.' })
  @IsNotEmpty({ message: 'اختيار المورد مطلوب.' })
  supplierId: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  supplierInvoiceRef?: string;

  @IsOptional()
  @IsString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsEnum(PurchasePaymentType, {
    message: 'طريقة الدفع يجب أن تكون CASH أو ELECTRONIC أو CREDIT أو PARTIAL.',
  })
  paymentType: PurchasePaymentType;

  @IsOptional()
  @IsUUID('4', { message: 'معرّف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'ضريبة الفاتورة لا يمكن أن تكون سالبة.' })
  taxAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'خصم الفاتورة لا يمكن أن يكون سالباً.' })
  discountAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'المبلغ المدفوع لا يمكن أن يكون سالباً.' })
  paidAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsEnum(PurchaseInvoiceStatus, { message: 'حالة الإنشاء يجب أن تكون DRAFT أو POSTED.' })
  status?: PurchaseInvoiceStatus;

  @IsOptional()
  @IsEnum(CostingMethod, {
    message: 'طريقة احتساب التكلفة يجب أن تكون WEIGHTED_AVERAGE أو LAST_PRICE أو FIFO.',
  })
  costingMethod?: CostingMethod;

  @IsOptional()
  @IsBoolean()
  promptOnSameDayPriceDiff?: boolean;

  @IsArray({ message: 'بنود فاتورة الشراء مطلوبة.' })
  @ArrayMinSize(1, { message: 'يجب أن تحتوي فاتورة الشراء على بند واحد على الأقل.' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineInputDto)
  items: PurchaseLineInputDto[];
}

export class UpdateDraftPurchaseDto {
  @IsOptional()
  @IsUUID('4')
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  supplierInvoiceRef?: string | null;

  @IsOptional()
  @IsString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  dueDate?: string | null;

  @IsOptional()
  @IsEnum(PurchasePaymentType)
  paymentType?: PurchasePaymentType;

  @IsOptional()
  @IsUUID('4')
  walletId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paidAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @IsEnum(CostingMethod)
  costingMethod?: CostingMethod;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineInputDto)
  items?: PurchaseLineInputDto[];
}

export class PostPurchaseDto {
  @IsOptional()
  @IsEnum(CostingMethod)
  costingMethod?: CostingMethod;

  @IsOptional()
  @IsBoolean()
  promptOnSameDayPriceDiff?: boolean;
}

export class VoidPurchaseDto {
  @IsString({ message: 'سبب إلغاء الفاتورة مطلوب.' })
  @IsNotEmpty({ message: 'سبب إلغاء الفاتورة مطلوب.' })
  @MinLength(3, { message: 'سبب الإلغاء قصير جداً.' })
  @MaxLength(500)
  reason: string;
}

export class CreatePurchaseReturnDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsUUID('4', { message: 'معرّف بند الفاتورة مطلوب.' })
  @IsNotEmpty({ message: 'تحديد بند الفاتورة مطلوب.' })
  purchaseItemId: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'الكمية المرتجعة مطلوبة.' })
  @Min(0.001, { message: 'الكمية المرتجعة يجب أن تكون أكبر من صفر.' })
  quantity: number;

  @IsEnum(PurchaseRefundMethod, {
    message: 'طريقة استرداد المرتجع يجب أن تكون DEBT_REDUCTION أو CASH_REFUND.',
  })
  refundMethod: PurchaseRefundMethod;

  @IsString({ message: 'سبب المرتجع مطلوب.' })
  @IsNotEmpty({ message: 'سبب المرتجع مطلوب.' })
  @MinLength(2, { message: 'سبب المرتجع قصير جداً.' })
  @MaxLength(500)
  reason: string;
}

export class QueryPurchasesDto {
  @IsOptional()
  @IsUUID('4')
  supplier_id?: string;

  @IsOptional()
  @IsEnum(PurchaseInvoiceStatus)
  status?: PurchaseInvoiceStatus;

  @IsOptional()
  @IsEnum(PurchasePaymentType)
  payment_type?: PurchasePaymentType;

  @IsOptional()
  @IsString()
  date_from?: string;

  @IsOptional()
  @IsString()
  date_to?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
