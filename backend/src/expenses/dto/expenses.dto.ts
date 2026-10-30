import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ExpenseAccrualTargetType, ExpensePaymentMethod, UtilityType } from '@prisma/client';

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
  @IsIn(['CASH', 'ELECTRONIC'], { message: 'صرف السلفة يكون نقداً أو عبر محفظة إلكترونية.' })
  paymentMethod?: 'CASH' | 'ELECTRONIC';

  @IsOptional()
  @IsUUID('all', { message: 'معرف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

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

  @IsOptional()
  @IsEnum(ExpensePaymentMethod, { message: 'طريقة الدفع يجب أن تكون CASH أو ELECTRONIC أو CREDIT.' })
  paymentMethod?: ExpensePaymentMethod;

  @IsOptional()
  @IsUUID('all', { message: 'معرف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}

export class CreateRentRecordDto {
  @IsNumber({}, { message: 'مبلغ الإيجار يجب أن يكون رقماً.' })
  @IsPositive({ message: 'مبلغ الإيجار يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsOptional()
  @IsEnum(ExpensePaymentMethod, { message: 'طريقة الدفع يجب أن تكون CASH أو ELECTRONIC أو CREDIT.' })
  paymentMethod?: ExpensePaymentMethod;

  @IsOptional()
  @IsUUID('all', { message: 'معرف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @IsString({ message: 'اسم القائم بالدفع مطلوب.' })
  @IsNotEmpty({ message: 'اسم القائم بالدفع مطلوب.' })
  payerName: string;

  @IsString({ message: 'اسم المستلم مطلوب.' })
  @IsNotEmpty({ message: 'اسم المستلم مطلوب.' })
  receiverName: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateUtilityPaymentDto {
  @IsEnum(UtilityType, { message: 'نوع المصروف يجب أن يكون WATER أو ELECTRICITY أو INTERNET أو OTHER.' })
  utilityType: UtilityType;

  @IsOptional()
  @IsString({ message: 'بيان المصروف الآخر يجب أن يكون نصاً.' })
  utilityTypeOther?: string;

  @IsNumber({}, { message: 'المبلغ يجب أن يكون رقماً.' })
  @IsPositive({ message: 'المبلغ يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsOptional()
  @IsEnum(ExpensePaymentMethod, { message: 'طريقة الدفع يجب أن تكون CASH أو ELECTRONIC أو CREDIT.' })
  paymentMethod?: ExpensePaymentMethod;

  @IsOptional()
  @IsUUID('all', { message: 'معرف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateWorkerAdvanceDto {
  @IsNumber({}, { message: 'مبلغ السلفة يجب أن يكون رقماً.' })
  @IsPositive({ message: 'مبلغ السلفة يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsOptional()
  @IsIn(['CASH', 'ELECTRONIC'], { message: 'صرف السلفة يكون نقداً أو عبر محفظة إلكترونية.' })
  paymentMethod?: 'CASH' | 'ELECTRONIC';

  @IsOptional()
  @IsUUID('all', { message: 'معرف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @IsOptional()
  @IsString({ message: 'الملاحظة يجب أن تكون نصاً.' })
  note?: string;
}

export class SettleExpenseAccrualDto {
  @IsEnum(ExpenseAccrualTargetType, { message: 'نوع المصروف المستحق غير صالح.' })
  targetType: ExpenseAccrualTargetType;

  @IsUUID('all', { message: 'معرف المصروف المستحق غير صالح.' })
  targetId: string;

  @IsNumber({}, { message: 'مبلغ السداد يجب أن يكون رقماً.' })
  @IsPositive({ message: 'مبلغ السداد يجب أن يكون أكبر من صفر.' })
  amount: number;

  @IsIn(['CASH', 'ELECTRONIC'], { message: 'طريقة السداد يجب أن تكون CASH أو ELECTRONIC.' })
  paymentMethod: 'CASH' | 'ELECTRONIC';

  @IsOptional()
  @IsUUID('all', { message: 'معرف المحفظة غير صالح.' })
  walletId?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateUnifiedExpenseDto {
  @IsString()
  @IsNotEmpty()
  type: string; // RENT | UTILITY | ELECTRICITY | WATER | INTERNET | OTHER | SALARY | ADVANCE | WORKER_ADVANCE

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsEnum(ExpensePaymentMethod)
  paymentMethod?: ExpensePaymentMethod;

  @IsOptional()
  @IsUUID('all')
  walletId?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  utilityTypeOther?: string;

  @IsOptional()
  @IsString()
  payerName?: string;

  @IsOptional()
  @IsString()
  receiverName?: string;

  @IsOptional()
  @IsUUID('all')
  employeeId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deductAdvances?: number;
}
