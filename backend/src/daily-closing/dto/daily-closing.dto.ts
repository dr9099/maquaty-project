import { IsNumber, Min } from 'class-validator';

export class UpdateActualCashDto {
  @IsNumber({}, { message: 'الكاش الفعلي يجب أن يكون رقماً.' })
  @Min(0, { message: 'الكاش الفعلي لا يمكن أن يكون سالباً.' })
  actualCash: number;
}
