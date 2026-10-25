import { IsNotEmpty, IsString } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'رقم الجوال مطلوب.' })
  phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة.' })
  password!: string;
}

export class AdminMfaVerifyDto {
  @IsString()
  @IsNotEmpty({ message: 'رمز تحدي MFA مطلوب.' })
  mfaChallengeToken!: string;

  @IsString()
  @IsNotEmpty({ message: 'كود MFA مطلوب.' })
  code!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty({ message: 'refresh_token مطلوب.' })
  refreshToken!: string;
}
