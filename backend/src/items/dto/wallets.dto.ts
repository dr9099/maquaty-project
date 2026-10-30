import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المحفظة مطلوب.' })
  @MaxLength(100)
  name!: string;
}

export class SettleWalletDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'الرصيد الفعلي لدى مزود المحفظة يجب أن يكون رقماً.' })
  @Min(0, { message: 'الرصيد الفعلي لدى المزود لا يمكن أن يكون سالباً.' })
  actualProviderBalance!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'مبلغ السحب النقدي للصندوق يجب أن يكون رقماً.' })
  @Min(0, { message: 'مبلغ السحب النقدي للصندوق لا يمكن أن يكون سالباً.' })
  cashOutToDrawer?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
