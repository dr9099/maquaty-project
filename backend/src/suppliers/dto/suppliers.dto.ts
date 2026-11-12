import { Type } from 'class-transformer';
import {
  IsBooleanString,
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
} from 'class-validator';
import { PaymentType, SupplierStatus } from '@prisma/client';

export class QuerySuppliersDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(SupplierStatus, { message: 'حالة المورد يجب أن تكون ACTIVE أو SUSPENDED.' })
  status?: SupplierStatus;

  @IsOptional()
  @IsBooleanString()
  only_with_debt?: string;

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

export class CreateSupplierDto {
  @IsOptional()
  @IsUUID('4', { message: 'معرّف المورد غير صالح.' })
  id?: string;

  @IsOptional()
  @IsString()
  clientOpId?: string;

  @IsString({ message: 'اسم المورد مطلوب.' })
  @IsNotEmpty({ message: 'اسم المورد مطلوب.' })
  @MinLength(2, { message: 'اسم المورد يجب ألا يقل عن حرفين.' })
  @MaxLength(120, { message: 'اسم المورد طويل جداً.' })
  name: string;

  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً.' })
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'الرصيد الافتتاحي يجب أن يكون رقماً.' })
  @Min(0, { message: 'الرصيد الافتتاحي لا يمكن أن يكون سالباً.' })
  openingBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'سقف الائتمان يجب أن يكون رقماً.' })
  @Min(0, { message: 'سقف الائتمان لا يمكن أن يكون سالباً.' })
  creditLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'مهلة السداد بالأيام يجب أن تكون عدداً صحيحاً.' })
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'اسم المورد يجب ألا يقل عن حرفين.' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  taxNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'سقف الائتمان لا يمكن أن يكون سالباً.' })
  creditLimit?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number | null;

  @IsOptional()
  @IsEnum(SupplierStatus, { message: 'حالة المورد يجب أن تكون ACTIVE أو SUSPENDED.' })
  status?: SupplierStatus;
}

export class RecordSupplierPaymentDto {
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الدفعة غير صالح.' })
  id?: string;

  @IsOptional()
  @IsString()
  clientOpId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'معرّف المورد غير صالح.' })
  supplierId?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'مبلغ الدفعة مطلوب ويجب أن يكون رقماً.' })
  @Min(0.01, { message: 'مبلغ الدفعة يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsEnum(PaymentType, { message: 'طريقة السداد يجب أن تكون CASH أو ELECTRONIC.' })
  paymentMethod: PaymentType;

  @IsOptional()
  @IsUUID('4', { message: 'معرّف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'معرّف فاتورة الشراء غير صالح.' })
  purchaseInvoiceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptAttachmentUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class QueryStatementDto {
  @IsOptional()
  @IsString()
  date_from?: string;

  @IsOptional()
  @IsString()
  date_to?: string;

  @IsOptional()
  @IsString()
  format?: 'json' | 'csv' | 'excel' | 'pdf';
}
