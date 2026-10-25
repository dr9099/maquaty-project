import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SetNewPasswordDto {
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب ألا تقل عن 8 خانات.' }) // R-34
  newPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'تأكيد كلمة المرور مطلوب.' })
  newPasswordConfirmation!: string;
}
