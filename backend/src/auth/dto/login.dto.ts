import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'رقم الجوال مطلوب.' })
  phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة.' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'بصمة الجهاز مطلوبة.' })
  deviceFingerprint!: string;
}
