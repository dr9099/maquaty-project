import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateReturnDto {
  @IsUUID('all', { message: 'معرف عملية البيع يجب أن يكون UUID صالحاً.' })
  saleId: string;

  @IsNumber({}, { message: 'الكمية المرتجعة يجب أن تكون رقماً.' })
  @IsPositive({ message: 'الكمية المرتجعة يجب أن تكون أكبر من صفر.' })
  quantity: number;

  @IsOptional()
  @IsIn(['KILO', 'GRAM'], { message: 'وحدة الإدخال يجب أن تكون KILO أو GRAM.' })
  quantityUnit?: 'KILO' | 'GRAM';

  @IsOptional()
  @IsNumber({}, { message: 'المبلغ المرتجع يجب أن يكون رقماً.' })
  @IsPositive({ message: 'المبلغ المرتجع يجب أن تكون أكبر من صفر.' })
  amount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
