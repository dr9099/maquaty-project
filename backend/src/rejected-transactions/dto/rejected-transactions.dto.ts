import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive } from 'class-validator';
import { ResolutionAction } from '@prisma/client';

// DTO لمعالجة العمليات المرفوضة — API_SPEC القسم 11 / R-30
export class ResolveRejectedTransactionDto {
  @IsEnum(ResolutionAction, {
    message:
      'نوع المعالجة غير صالح. يجب أن يكون POST_AS_LOSS أو ADD_CREDIT أو APPROVE_ADJUSTED_QTY أو APPROVE_NEGATIVE_STOCK أو FINAL_REJECT.',
  })
  @IsNotEmpty({ message: 'إجراء المعالجة إلزامي.' })
  resolutionAction: ResolutionAction;

  @IsOptional()
  @IsNumber({}, { message: 'الكمية المصححة يجب أن تكون رقماً.' })
  @IsPositive({ message: 'الكمية المصححة يجب أن تكون أكبر من صفر.' })
  adjustedQuantity?: number;
}
