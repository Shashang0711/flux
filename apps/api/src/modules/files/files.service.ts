import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StoredFile } from '@prisma/client';
import {
  ErrorCode,
  FILE_KINDS,
  FILE_PURPOSES,
  MAX_FILE_BYTES,
  detectFileKind,
  type DownloadLinkDto,
  type FileDto,
  type UploadIntentDto,
  type createUploadSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { PrismaService } from '../../database/prisma.service';
import type { Env } from '../../config/env';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { FILE_STORAGE, type FileStorage } from './storage';

/** How long a download link stays valid. */
const LINK_SECONDS = 300;

type Row = StoredFile & { uploadedBy?: { name: string } | null };

export function toFileDto(f: Row): FileDto {
  return {
    id: f.id,
    name: f.name,
    contentType: f.contentType,
    size: f.size,
    purpose: f.purpose,
    status: f.status,
    uploadedAt: (f.uploadedAt ?? f.createdAt).toISOString(),
    uploadedBy: f.uploadedBy?.name ?? null,
  };
}

function invalid(path: string, message: string): AppException {
  return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, message, [
    { path, message },
  ]);
}

/**
 * Staged file uploads (design pack §20): intent → raw upload → size/type/checksum checks →
 * READY → attached by the owning feature (lab report, sample attachment) via `claim()`.
 * Downloads use HMAC-signed, short-lived links; issuing one is the permission check.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly secret: Buffer;

  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    config: ConfigService<Env, true>,
  ) {
    const configured = config.get('FILE_URL_SECRET', { infer: true });
    if (!configured)
      this.logger.warn('FILE_URL_SECRET is not set; download links reset on restart');
    this.secret = configured ? Buffer.from(configured) : randomBytes(32);
  }

  createUpload(
    ctx: TenantContext,
    user: AuthUser,
    input: z.output<typeof createUploadSchema>,
  ): Promise<UploadIntentDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const id = crypto.randomUUID();
      const file = await tx.storedFile.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          purpose: input.purpose,
          name: input.name,
          size: input.size,
          storageKey: `${ctx.tenantId}/${id}`,
          uploadedById: user.id,
        },
      });
      return { file: toFileDto(file), uploadPath: `/files/${file.id}/content` };
    });
  }

  /** Receives the bytes of a pending upload (only from the user who started it). */
  async upload(ctx: TenantContext, user: AuthUser, id: string, body: Buffer): Promise<FileDto> {
    const file = await this.db.run(ctx.tenantId, (tx) =>
      tx.storedFile.findUnique({ where: { id } }),
    );
    if (!file || file.uploadedById !== user.id) throw AppException.notFound('File', id);
    if (file.status !== 'PENDING')
      throw AppException.conflict('This file has already been uploaded');
    if (body.length === 0) throw invalid('file', 'The file is empty');
    if (body.length > MAX_FILE_BYTES) {
      throw invalid('file', `Files can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    }
    const kind = detectFileKind(body.subarray(0, 16), file.name);
    const allowed = FILE_PURPOSES[file.purpose].kinds;
    if (!kind || !allowed.includes(kind)) {
      const names = allowed.map((k) => FILE_KINDS[k].label).join(', ');
      throw invalid(
        'file',
        `This file is not an accepted type for a ${FILE_PURPOSES[file.purpose].name.toLowerCase()} (${names})`,
      );
    }
    const contentType = FILE_KINDS[kind].contentType;
    await this.storage.put(file.storageKey, body, contentType);
    return this.db.run(ctx.tenantId, async (tx) => {
      const ready = await tx.storedFile.update({
        where: { id },
        data: {
          status: 'READY',
          size: body.length,
          contentType,
          sha256: createHash('sha256').update(body).digest('hex'),
          uploadedAt: new Date(),
        },
        include: { uploadedBy: { select: { name: true } } },
      });
      return toFileDto(ready);
    });
  }

  /**
   * For the owning feature: the file must be READY, of this purpose, uploaded by this user and
   * not attached anywhere yet. Runs in the feature's transaction.
   */
  async claim(
    tx: TenantTx,
    user: AuthUser,
    fileId: string,
    purpose: StoredFile['purpose'],
    path = 'fileId',
  ) {
    const file = await tx.storedFile.findUnique({
      where: { id: fileId },
      include: { reportVersions: { select: { id: true } }, attachments: { select: { id: true } } },
    });
    if (!file || file.uploadedById !== user.id) throw invalid(path, 'Upload the file first');
    if (file.status !== 'READY') throw invalid(path, 'The file upload has not finished');
    if (file.purpose !== purpose) throw invalid(path, 'This file was uploaded for something else');
    if (file.reportVersions.length > 0 || file.attachments.length > 0) {
      throw invalid(path, 'This file is already attached');
    }
    return file;
  }

  /** A short-lived link to download the file. Callers check the user may see the file first. */
  link(fileId: string): DownloadLinkDto {
    const expires = Math.floor(Date.now() / 1000) + LINK_SECONDS;
    return {
      path: `/files/${fileId}/download?expires=${expires}&token=${this.sign(fileId, expires)}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /** Serves a signed link (no session needed: the signature is the authorisation). */
  async open(
    fileId: string,
    expires: number,
    token: string,
  ): Promise<{ file: StoredFile; stream: Readable }> {
    const expected = Buffer.from(this.sign(fileId, expires));
    const given = Buffer.from(token);
    if (
      expires < Date.now() / 1000 ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'This download link has expired',
      );
    }
    // Outside any tenant context: the signed id is the only key, read with system access.
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.status !== 'READY') throw AppException.notFound('File', fileId);
    return { file, stream: await this.storage.get(file.storageKey) };
  }

  private sign(fileId: string, expires: number): string {
    return createHmac('sha256', this.secret).update(`${fileId}:${expires}`).digest('base64url');
  }
}
