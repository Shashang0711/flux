import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  MAX_FILE_BYTES,
  createUploadSchema,
  downloadQuerySchema,
  type FileDto,
  type UploadIntentDto,
} from '@flux/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, Public } from '../auth/decorators';
import { FilesService } from './files.service';

/** Reads the raw request body, refusing it as soon as it passes the size limit. */
function readBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FILE_BYTES + 1) {
        req.destroy();
        reject(AppException.badRequest(`Files can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Staged uploads and signed downloads. Any signed-in tenant user may upload (a file is only
 * useful once a feature with its own permission check attaches it); download links are issued
 * by those features (lab reports, sample attachments).
 */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  createUpload(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(createUploadSchema)) input: z.output<typeof createUploadSchema>,
  ): Promise<UploadIntentDto> {
    return this.files.createUpload(t, u, input);
  }

  @Put(':id/content')
  async upload(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<FileDto> {
    return this.files.upload(t, u, id, await readBody(req));
  }

  @Get(':id/download')
  @Public()
  @RawResponse()
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(downloadQuerySchema)) q: z.output<typeof downloadQuerySchema>,
    @Res() res: Response,
  ): Promise<void> {
    const { file, stream } = await this.files.open(id, q.expires, q.token);
    res.setHeader('Content-Type', file.contentType ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }
}
