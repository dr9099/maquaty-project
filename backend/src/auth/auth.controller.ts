import { Body, Controller, HttpCode, Ip, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ApiError } from '../common/api-error';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { getRequestUser } from '../common/types';
import { AuthService } from './auth.service';
import { AdminLoginDto, AdminMfaVerifyDto, RefreshDto } from './dto/admin.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterStoreOwnerDto } from './dto/register-store-owner.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';

// المصادقة — API_SPEC.md القسم 1
@Controller('auth')
@UseFilters(ApiExceptionFilter)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  @Post('register-store-owner')
  register(@Body() dto: RegisterStoreOwnerDto, @Ip() ip: string) {
    return this.auth.registerStoreOwner(dto, ip);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  @Post('set-new-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  setNewPassword(@Body() dto: SetNewPasswordDto, @Ip() ip: string, @Req() req: Request) {
    return this.auth.setNewPassword(dto, getRequestUser(req), ip);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.auth.refresh(dto.refreshToken, ip);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.auth.logout(dto.refreshToken, ip);
  }

  @Post('admin/login')
  @HttpCode(200)
  adminLogin(@Body() dto: AdminLoginDto, @Ip() ip: string) {
    return this.auth.adminLogin(dto, ip);
  }

  @Post('admin/mfa/verify')
  @HttpCode(200)
  adminMfaVerify(@Body() dto: AdminMfaVerifyDto, @Ip() ip: string) {
    return this.auth.adminMfaVerify(dto, ip);
  }

  // فحص صحة التوكن (داخلي للاختبار)
  @Post('whoami')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  whoami(@Req() req: Request) {
    const user = getRequestUser(req);
    if (!user) throw ApiError.unauthorized('INVALID_CREDENTIALS', 'مصادقة ناقصة.');
    return user;
  }
}
