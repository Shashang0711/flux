import { z } from 'zod';

/**
 * Files (design pack §20): staged uploads to private object storage. A client asks for an upload
 * (purpose, name, size), sends the bytes to the returned URL, the API checks size and content
 * type (from the bytes, not the name) and the file becomes READY; it is then attached to a
 * record (lab report, sample). Downloads use short-lived signed links issued after a permission
 * check.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const FILE_KINDS = {
  pdf: { contentType: 'application/pdf', label: 'PDF' },
  png: { contentType: 'image/png', label: 'PNG image' },
  jpeg: { contentType: 'image/jpeg', label: 'JPEG image' },
  csv: { contentType: 'text/csv', label: 'CSV' },
  xlsx: {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel workbook',
  },
  xls: { contentType: 'application/vnd.ms-excel', label: 'Excel 97–2003 workbook' },
} as const;
export type FileKind = keyof typeof FILE_KINDS;

export const FILE_PURPOSES = {
  LAB_REPORT: { kinds: ['pdf'] as FileKind[], name: 'Lab report' },
  RESULT_ATTACHMENT: {
    kinds: ['pdf', 'png', 'jpeg', 'csv', 'xlsx', 'xls'] as FileKind[],
    name: 'Result attachment',
  },
} as const;
export type FilePurpose = keyof typeof FILE_PURPOSES;
export const FILE_PURPOSE_KEYS = Object.keys(FILE_PURPOSES) as [FilePurpose, ...FilePurpose[]];

/** For <input type="file" accept>. */
export function acceptFor(purpose: FilePurpose): string {
  return FILE_PURPOSES[purpose].kinds
    .flatMap((k) => [FILE_KINDS[k].contentType, `.${k}`])
    .join(',');
}

/**
 * Detects a file's kind from its first bytes (and, for text and zip-based formats, its name).
 * Returns null for anything else.
 */
export function detectFileKind(head: Uint8Array, name: string): FileKind | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'pdf'; // %PDF-
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x50, 0x4b, 0x03, 0x04) && ext === 'xlsx') return 'xlsx'; // zip container
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) && ext === 'xls') return 'xls';
  if (ext === 'csv' && head.length > 0 && !head.includes(0)) return 'csv';
  return null;
}

export interface FileDto {
  id: string;
  name: string;
  contentType: string | null;
  size: number;
  purpose: FilePurpose;
  status: 'PENDING' | 'READY';
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface UploadIntentDto {
  file: FileDto;
  /** PUT the raw bytes here (relative to the API base, e.g. /files/<id>/content). */
  uploadPath: string;
}

export interface DownloadLinkDto {
  /** Relative to the API base; valid until expiresAt. */
  path: string;
  expiresAt: string;
}

export const createUploadSchema = z.object({
  purpose: z.enum(FILE_PURPOSE_KEYS),
  name: z
    .string()
    .trim()
    .min(1, 'File name is required')
    .max(200)
    // Keep names safe to show and to send back in Content-Disposition.
    .transform((v) =>
      [...v]
        .map((c) => (c.charCodeAt(0) < 32 || c === '/' || c === '\\' || c === '"' ? '_' : c))
        .join(''),
    ),
  size: z.coerce
    .number()
    .int()
    .min(1, 'The file is empty')
    .max(MAX_FILE_BYTES, `Files can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`),
});
export type CreateUploadRequest = z.input<typeof createUploadSchema>;

export const downloadQuerySchema = z.object({
  expires: z.coerce.number().int(),
  token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
});
