import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class RegisterStoreOwnerDto {
  @IsString()
  @IsNotEmpty({ message: 'الاسم الكامل مطلوب.' })
  fullName!: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم المحل مطلوب.' })
  storeName!: string;

  @IsString()
  @Matches(/^[0-9]{7,15}$/, { message: 'رقم الجوال غير صالح.' })
  phone!: string;

  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب ألا تقل عن 8 خانات.' }) // R-34
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'تأكيد كلمة المرور مطلوب.' })
  passwordConfirmation!: string;

  @IsString()
  @IsNotEmpty({ message: 'بصمة الجهاز مطلوبة.' }) // R-25
  deviceFingerprint!: string;
}
