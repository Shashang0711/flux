import {
  ErrorCode,
  MAX_FILE_BYTES,
  type DownloadLinkDto,
  type FileDto,
  type FilePurpose,
  type UploadIntentDto,
} from '@flux/shared';
import { ApiError, apiBaseUrl, apiFetch } from './api';

/**
 * Staged upload (browser): ask for an upload, send the raw bytes, get the checked file back.
 * Errors come back as ApiError with the field "file" (wrong type, too large, …).
 */
export async function uploadFile(purpose: FilePurpose, file: File): Promise<FileDto> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError(400, {
      code: ErrorCode.VALIDATION_ERROR,
      message: `Files can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`,
      details: [
        { path: 'file', message: `Files can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB` },
      ],
    });
  }
  const intent = await apiFetch<UploadIntentDto>('/files', {
    method: 'POST',
    body: JSON.stringify({ purpose, name: file.name, size: file.size }),
  });
  const uploaded = await apiFetch<FileDto>(intent.data.uploadPath, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  return uploaded.data;
}

/** A form error on the file field (e.g. no file chosen), shown like the API's own. */
export function fileError(message: string): ApiError {
  return new ApiError(400, {
    code: ErrorCode.VALIDATION_ERROR,
    message,
    details: [{ path: 'file', message }],
  });
}

/** Asks the API for a short-lived signed link (the permission check) and starts the download. */
export async function downloadVia(linkPath: string): Promise<void> {
  const link = await apiFetch<DownloadLinkDto>(linkPath);
  window.location.assign(`${apiBaseUrl()}${link.data.path}`);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
