import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class RecordDamagedGoodsDto {
  @IsOptional()
  @IsUUID('all', { message: 'معرف العملية غير صالح.' })
  id?: string;

  @IsOptional()
  @IsString()
  clientOpId?: string;

  @IsUUID('all', { message: 'معرف الصنف يجب أن يكون UUID صالحاً.' })
  itemId: string;

  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً.' })
  @IsPositive({ message: 'الكمية التالفة يجب أن تكون أكبر من صفر.' })
  quantity: number;

  @IsBoolean({ message: 'حالة التلف يجب أن تكون قيمة منطقية.' })
  isDamaged: boolean;

  @IsOptional()
  @IsString({ message: 'سبب التلف يجب أن يكون نصاً.' })
  reason?: string;

  @IsOptional()
  @IsString({ message: 'رابط صورة التالف يجب أن يكون نصاً.' })
  photoUrl?: string;
}
