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
import { randomUUID } from 'node:crypto';
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

type DetectedSignature = 'jpeg' | 'png' | 'webp' | 'pdf';

function detectFileSignature(filePath: string): DetectedSignature | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    // JPEG: FF D8 FF
    if (bytesRead >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'jpeg';
    }
    // PNG: 89 50 4E 47
    if (
      bytesRead >= 4 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      return 'png';
    }
    // WEBP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
    if (
      bytesRead >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    ) {
      return 'webp';
    }
    // PDF: 25 50 44 46 (%PDF)
    if (
      bytesRead >= 4 &&
      buf[0] === 0x25 &&
      buf[1] === 0x50 &&
      buf[2] === 0x44 &&
      buf[3] === 0x46
    ) {
      return 'pdf';
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

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
          const unique = `${randomUUID()}${safeExt}`;
          cb(null, unique);
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 1,
      },
      fileFilter: (_req: any, file: any, cb: (err: Error | null, accept: boolean) => void) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const mime = (file.mimetype || '').toLowerCase();
        const extAllowed = ext ? ALLOWED_EXTENSIONS.includes(ext) : ALLOWED_MIME_TYPES.includes(mime);
        if (extAllowed && (ALLOWED_MIME_TYPES.includes(mime) || ALLOWED_EXTENSIONS.includes(ext))) {
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

    const filePath = file.path || path.join(uploadDir, file.filename);
    let signature: DetectedSignature | null = null;
    try {
      signature = fs.existsSync(filePath) ? detectFileSignature(filePath) : null;
    } catch {
      signature = null;
    }

    const ext = path.extname(file.filename || file.originalname || '').toLowerCase();
    const isPdfExt = ext === '.pdf';
    const mismatch = signature === 'pdf' ? !isPdfExt : isPdfExt;

    if (!signature || mismatch) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
      throw ApiError.badRequest(
        'INVALID_FILE_TYPE',
        'يُسمح فقط بملفات الصور (JPG, PNG, WEBP) وملفات PDF ذات التوقيع الصحيح.',
      );
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
    if (!safeFilename || safeFilename.startsWith('.') || !/^[a-zA-Z0-9._-]+$/.test(safeFilename)) {
      throw ApiError.notFound('الملف المطلوب غير موجود.');
    }
    const filePath = path.resolve(uploadDir, safeFilename);
    if (!filePath.startsWith(uploadDir + path.sep) || !fs.existsSync(filePath)) {
      throw ApiError.notFound('الملف المطلوب غير موجود.');
    }
    res.setHeader?.('X-Content-Type-Options', 'nosniff');
    res.setHeader?.('Content-Security-Policy', "default-src 'none'");
    return res.sendFile(filePath);
  }
}
