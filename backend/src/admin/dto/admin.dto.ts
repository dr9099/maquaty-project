import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ActorType,
  BroadcastPriority,
  BroadcastTargetType,
  BroadcastType,
  DeviceStatus,
  StoreOwnerStatus,
} from '@prisma/client';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export class StoreOwnersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(StoreOwnerStatus)
  status?: StoreOwnerStatus;
}

export class UpdateStoreOwnerStatusDto {
  @IsEnum(['ACTIVE', 'SUSPENDED'], {
    message: 'الحالة يجب أن تكون ACTIVE أو SUSPENDED',
  })
  status!: 'ACTIVE' | 'SUSPENDED';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateWorkerLimitDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxWorkersAllowed!: number;
}

export class CreateSubscriptionPlanDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الخطة مطلوب' })
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays!: number;

  @IsOptional()
  @IsBoolean()
  isCustom?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSubscriptionPlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSubscriptionDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  agreedAmount?: number;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number;
}

export class UpdateSubscriptionDto {
  @IsEnum(['extend', 'change_duration', 'cancel', 'reactivate'], {
    message: 'الإجراء غير مدعوم',
  })
  action!: 'extend' | 'change_duration' | 'cancel' | 'reactivate';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;

  @IsOptional()
  @IsString()
  newExpiresAt?: string;
}

export class DevicesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  storeOwnerId?: string;

  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @IsOptional()
  @IsString()
  search?: string;
}

export class BroadcastsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBroadcastDto {
  @IsEnum(BroadcastType)
  type!: BroadcastType;

  @IsString()
  @IsNotEmpty({ message: 'عنوان الإشعار مطلوب' })
  title!: string;

  @IsString()
  @IsNotEmpty({ message: 'نص الإشعار مطلوب' })
  body!: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  buttonText?: string;

  @IsOptional()
  @IsString()
  buttonUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationHours?: number;

  @IsOptional()
  @IsBoolean()
  dismissible?: boolean;

  @IsOptional()
  @IsEnum(BroadcastPriority)
  priority?: BroadcastPriority;

  @IsEnum(BroadcastTargetType)
  targetType!: BroadcastTargetType;

  @IsOptional()
  @IsUUID()
  targetDeviceId?: string;

  @IsOptional()
  @IsString()
  discountCode?: string;

  @IsOptional()
  @IsString()
  discountPercentText?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBroadcastDto {
  @IsOptional()
  @IsEnum(BroadcastType)
  type?: BroadcastType;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  buttonText?: string;

  @IsOptional()
  @IsString()
  buttonUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationHours?: number;

  @IsOptional()
  @IsBoolean()
  dismissible?: boolean;

  @IsOptional()
  @IsEnum(BroadcastPriority)
  priority?: BroadcastPriority;

  @IsOptional()
  @IsEnum(BroadcastTargetType)
  targetType?: BroadcastTargetType;

  @IsOptional()
  @IsUUID()
  targetDeviceId?: string;

  @IsOptional()
  @IsString()
  discountCode?: string;

  @IsOptional()
  @IsString()
  discountPercentText?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SettingItemDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  value!: any;
}

export class UpdateSettingsDto {
  @IsOptional()
  settings?: SettingItemDto[];

  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  value?: any;
}

export class AuditLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ActorType)
  actorType?: ActorType;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsString()
  actionType?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;
}
