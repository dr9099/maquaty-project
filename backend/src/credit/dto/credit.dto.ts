import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateCreditCustomerDto {
  @IsString({ message: 'اسم العميل يجب أن يكون نصاً.' })
  @IsNotEmpty({ message: 'اسم العميل إلزامي.' })
  name: string;

  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً.' })
  phone?: string;

  @IsOptional()
  @IsNumber({}, { message: 'سقف الائتمان يجب أن يكون رقماً.' })
  @IsPositive({ message: 'سقف الائتمان يجب أن يكون موجباً.' })
  creditLimit?: number;
}

export class UpdateCreditCustomerDto {
  @IsOptional()
  @IsString({ message: 'اسم العميل يجب أن يكون نصاً.' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً.' })
  phone?: string;

  @IsOptional()
  @IsNumber({}, { message: 'سقف الائتمان يجب أن يكون رقماً.' })
  creditLimit?: number | null;
}

export class RecordCreditPaymentDto {
  @IsOptional()
  @IsUUID('all', { message: 'معرف الدفعة غير صالح.' })
  id?: string;

  @IsOptional()
  @IsString()
  clientOpId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'معرف العميل غير صالح.' })
  customerId?: string;

  @IsNumber({}, { message: 'المبلغ يجب أن يكون رقماً.' })
  @IsPositive({ message: 'مبلغ الدفعة يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsString({ message: 'طريقة الدفع يجب أن تكون CASH أو ELECTRONIC.' })
  paymentMethod: 'CASH' | 'ELECTRONIC';

  @IsOptional()
  @IsUUID('all', { message: 'معرف المحفظة يجب أن يكون UUID صالحاً.' })
  walletId?: string;

  @IsOptional()
  @IsString({ message: 'رابط مرفق الإيداع يجب أن يكون نصاً.' })
  attachmentUrl?: string;

  @IsOptional()
  @IsString()
  depositAttachmentUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
