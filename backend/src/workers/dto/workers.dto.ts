import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PermissionsDto {
  @IsOptional()
  @IsBoolean()
  showCostPrice?: boolean;

  @IsOptional()
  @IsBoolean()
  showSellPricesInventory?: boolean;

  @IsOptional()
  @IsBoolean()
  damagedGoodsEntry?: boolean;

  @IsOptional()
  @IsBoolean()
  reportsAccess?: boolean;

  @IsOptional()
  @IsBoolean()
  enterOwnAdvance?: boolean;

  @IsOptional()
  @IsBoolean()
  editWorkerClosingCash?: boolean;
}

export class CreateWorkerDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم العامل مطلوب.' })
  fullName!: string;

  @IsString()
  @IsNotEmpty({ message: 'رقم جوال العامل مطلوب.' })
  phone!: string;

  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب ألا تقل عن 8 خانات.' }) // R-34
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'تأكيد كلمة المرور مطلوب.' })
  passwordConfirmation!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PermissionsDto)
  permissions?: PermissionsDto;

  // إنشاء العامل المسؤول مباشرة أثناء الإضافة (SCREEN_SPEC 22) — دون استهلاك رصيد (R-33)
  @IsOptional()
  @IsBoolean()
  isResponsible?: boolean;

  @IsOptional()
  @IsBoolean()
  confirmReplace?: boolean;
}

export class UpdateWorkerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PermissionsDto)
  permissions?: PermissionsDto;
}

export class ChangeWorkerPasswordDto {
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب ألا تقل عن 8 خانات.' })
  newPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'تأكيد كلمة المرور مطلوب.' })
  newPasswordConfirmation!: string;
}

export class SuspendWorkerDto {
  @IsBoolean()
  suspended!: boolean;
}

export class PromoteResponsibleDto {
  @IsOptional()
  @IsBoolean()
  confirmReplace?: boolean;
}
