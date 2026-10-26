import { IsNotEmpty, IsString } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المحفظة مطلوب.' })
  name!: string;
}
