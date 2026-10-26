import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { UtilityType } from '@prisma/client';

export class CreateEmployeeDto {
  @IsString({ message: 'اسم الموظف يجب أن يكون نصاً.' })
  @IsNotEmpty({ message: 'اسم الموظف إلزامي.' })
  name: string;

  @IsNumber({}, { message: 'المستحق الشهري يجب أن يكون رقماً.' })
  @IsPositive({ message: 'المستحق الشهري يجب أن يكون أكبر من صفر.' })
  monthlyDue: number;

  @IsOptional()
  @IsUUID('all', { message: 'معرف العامل المرتبط يجب أن يكون UUID صالحاً.' })
  linkedWorkerId?: string;
}

export class CreateEmployeeAdvanceDto {
  @IsNumber({}, { message: 'مبلغ السلفة يجب أن يكون رقماً.' })
  @IsPositive({ message: 'مبلغ السلفة يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsOptional()
  @IsString({ message: 'الملاحظة يجب أن تكون نصاً.' })
  note?: string;
}

export class PayEmployeeDto {
  @IsNumber({}, { message: 'إجمالي المستحق المصروف يجب أن يكون رقماً.' })
  @IsPositive({ message: 'المبلغ المصروف يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsOptional()
  @IsNumber({}, { message: 'مبلغ خصم السلف يجب أن يكون رقماً.' })
  @Min(0, { message: 'مبلغ خصم السلف لا يمكن أن يكون سالباً.' })
  deductAdvances?: number;
}

export class CreateRentRecordDto {
  @IsNumber({}, { message: 'مبلغ الإيجار يجب أن يكون رقماً.' })
  @IsPositive({ message: 'مبلغ الإيجار يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsString({ message: 'طريقة الدفع مطلوبة.' })
  @IsNotEmpty({ message: 'طريقة الدفع مطلوبة.' })
  paymentMethod: string;

  @IsString({ message: 'اسم القائم بالدفع مطلوب.' })
  @IsNotEmpty({ message: 'اسم القائم بالدفع مطلوب.' })
  payerName: string;

  @IsString({ message: 'اسم المستلم مطلوب.' })
  @IsNotEmpty({ message: 'اسم المستلم مطلوب.' })
  receiverName: string;
}

export class CreateUtilityPaymentDto {
  @IsEnum(UtilityType, { message: 'نوع الخدمة يجب أن يكون WATER أو ELECTRICITY أو INTERNET أو OTHER.' })
  utilityType: UtilityType;

  @IsOptional()
  @IsString({ message: 'بيان الخدمة الأخرى يجب أن يكون نصاً.' })
  utilityTypeOther?: string;

  @IsNumber({}, { message: 'مبلغ الفاتورة يجب أن يكون رقماً.' })
  @IsPositive({ message: 'مبلغ الفاتورة يجب أن يكون أكبر من صفر.' })
  amount: number;
}

export class CreateWorkerAdvanceDto {
  @IsNumber({}, { message: 'مبلغ السلفة يجب أن يكون رقماً.' })
  @IsPositive({ message: 'مبلغ السلفة يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsOptional()
  @IsString({ message: 'الملاحظة يجب أن تكون نصاً.' })
  note?: string;
}
