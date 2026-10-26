import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';
import { PaymentType } from '@prisma/client';

export class CreateSaleDto {
  @IsUUID(undefined, { message: 'معرّف الصنف غير صالح.' })
  itemId!: string;

  @IsNumber()
  @IsPositive({ message: 'الكمية يجب أن تكون أكبر من صفر.' })
  quantity!: number;

  @IsNumber()
  @IsPositive({ message: 'المبلغ يجب أن يكون أكبر من صفر.' })
  amount!: number;

  @IsEnum(PaymentType, { message: 'طريقة الدفع يجب أن تكون نقداً أو إلكترونياً أو آجلاً.' })
  paymentType!: PaymentType;

  @IsOptional()
  @IsUUID(undefined, { message: 'معرّف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsString()
  depositAttachmentUrl?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'معرّف عميل الآجل غير صالح.' })
  creditCustomerId?: string;

  @IsOptional()
  @IsBoolean()
  isEmergencySale?: boolean;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  emergencyOverridePrice?: number;

  @IsOptional()
  @IsString()
  emergencyReason?: string;
}
