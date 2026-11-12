import { Body, Controller, HttpCode, Ip, Post, Req, UseFilters } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/api-error';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { Public } from '../common/public.decorator';
import { getRequestUser } from '../common/types';
import { AuthService } from './auth.service';
import { AdminLoginDto, AdminMfaVerifyDto, RefreshDto } from './dto/admin.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterStoreOwnerDto } from './dto/register-store-owner.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';

// المصادقة — API_SPEC القسم 1 (المصادقة وحالة الحساب يُفحصان عالمياً؛ المسارات العامة معلَّمة @Public)
@Controller('auth')
@UseFilters(ApiExceptionFilter)
export class AuthController {
  constructor(private readonly auth: AuthService) { }

  @Public()
  @Post('register-store-owner')
  register(@Body() dto: RegisterStoreOwnerDto, @Ip() ip: string) {
    return this.auth.registerStoreOwner(dto, ip);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  // توكن محدود الغرض (temp_access_token) — يُفحص عالمياً
  @Post('set-new-password')
  @HttpCode(200)
  setNewPassword(@Body() dto: SetNewPasswordDto, @Ip() ip: string, @Req() req: Request) {
    const rawFp = req.headers['x-device-fingerprint'];
    const deviceFingerprint =
      typeof rawFp === 'string' && rawFp.trim() ? rawFp.trim() : undefined;
    return this.auth.setNewPassword(dto, getRequestUser(req), ip, deviceFingerprint);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.auth.refresh(dto.refreshToken, ip);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.auth.logout(dto.refreshToken, ip);
  }

  @Public()
  @Post('admin/login')
  @HttpCode(200)
  adminLogin(@Body() dto: AdminLoginDto, @Ip() ip: string) {
    return this.auth.adminLogin(dto, ip);
  }

  @Public()
  @Post('admin/mfa/verify')
  @HttpCode(200)
  adminMfaVerify(@Body() dto: AdminMfaVerifyDto, @Ip() ip: string) {
    return this.auth.adminMfaVerify(dto, ip);
  }

  // فحص صحة التوكن (داخلي للاختبار)
  @Post('whoami')
  @HttpCode(200)
  whoami(@Req() req: Request) {
    const user = getRequestUser(req);
    if (!user) throw ApiError.unauthorized('INVALID_CREDENTIALS', 'مصادقة ناقصة.');
    return user;
  }
}
