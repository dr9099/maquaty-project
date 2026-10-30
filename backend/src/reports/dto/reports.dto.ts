import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OwnerTransactionType } from '@prisma/client';

export enum ReportType {
  SALES = 'sales',
  PURCHASES = 'purchases',
  EXPENSES = 'expenses',
  WITHDRAWALS = 'withdrawals',
  PURCHASES_BY_SUPPLIER = 'purchases_by_supplier',
  PURCHASES_BY_ITEM = 'purchases_by_item',
  SUPPLIER_PAYABLES = 'supplier_payables',
  PROFIT_MARGIN = 'profit_margin',
}

export class QueryReportsDto {
  @IsEnum(ReportType, {
    message:
      'نوع التقرير غير صالح. القيم المسموحة: sales, purchases, expenses, withdrawals, purchases_by_supplier, purchases_by_item, supplier_payables, profit_margin.',
  })
  @IsNotEmpty({ message: 'نوع التقرير مطلوب.' })
  type: ReportType;

  @IsOptional()
  @IsString()
  date_from?: string;

  @IsOptional()
  @IsString()
  date_to?: string;

  @IsOptional()
  @IsString()
  format?: 'json' | 'pdf' | 'excel' | 'csv';

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

export class QueryRangeDto {
  @IsOptional()
  @IsString()
  date_from?: string;

  @IsOptional()
  @IsString()
  date_to?: string;

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

export class CreateOwnerTransactionDto {
  @IsEnum(OwnerTransactionType, { message: 'نوع العملية يجب أن يكون DEPOSIT (إيداع) أو WITHDRAWAL (سحب).' })
  @IsNotEmpty({ message: 'نوع العملية مطلوب.' })
  type!: OwnerTransactionType;

  @Type(() => Number)
  @IsNumber({}, { message: 'المبلغ يجب أن يكون رقماً.' })
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من الصفر.' })
  amount!: number;

  @IsOptional()
  @IsIn(['CASH', 'ELECTRONIC'], { message: 'طريقة الدفع يجب أن تكون CASH أو ELECTRONIC.' })
  paymentMethod?: 'CASH' | 'ELECTRONIC';

  @IsOptional()
  @IsUUID('all', { message: 'معرف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
