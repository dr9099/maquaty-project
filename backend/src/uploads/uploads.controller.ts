import {
  Controller,
  Post,
  Get,
  Param,
  Res,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { ApiError } from '../common/api-error';
import { Public } from '../common/public.decorator';

const uploadDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'application/pdf',
];

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

@Controller('uploads')
export class UploadsController {
  @Post()
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: diskStorage({
        destination: (_req: any, _file: any, cb: (err: Error | null, dest: string) => void) => {
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (_req: any, file: any, cb: (err: Error | null, name: string) => void) => {
          const ext = path.extname(file.originalname).toLowerCase();
          const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : '.jpg';
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
          cb(null, unique);
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
      fileFilter: (_req: any, file: any, cb: (err: Error | null, accept: boolean) => void) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const mime = (file.mimetype || '').toLowerCase();
        if (ALLOWED_MIME_TYPES.includes(mime) || ALLOWED_EXTENSIONS.includes(ext)) {
          cb(null, true);
        } else {
          cb(
            ApiError.badRequest(
              'INVALID_FILE_TYPE',
              'يُسمح فقط بملفات الصور (JPG, PNG, WEBP) وملفات PDF.',
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadFile(@UploadedFiles() files: any[]) {
    const file = files && files.length > 0 ? files[0] : null;
    if (!file) {
      throw ApiError.badRequest('MISSING_FILE', 'لم يتم إرفاق أي ملف.');
    }
    return {
      url: `/v1/uploads/${file.filename}`,
      filename: file.filename,
      size: file.size,
    };
  }

  @Get(':filename')
  @Public()
  async getFile(@Param('filename') filename: string, @Res() res: any) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(uploadDir, safeFilename);
    if (!fs.existsSync(filePath)) {
      throw ApiError.notFound('الملف المطلوب غير موجود.');
    }
    return res.sendFile(filePath);
  }
}
