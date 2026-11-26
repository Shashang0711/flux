import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../../config/env';

/** Private object storage for uploaded files. Keys look like "<tenant id>/<file id>". */
export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  /** Removes an object (rejected or abandoned uploads). Missing objects are fine. */
  remove(key: string): Promise<void>;
  /** Throws if the storage cannot be reached (readiness check). */
  check(): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
function checkKey(key: string): void {
  // Keys are generated from UUIDs; refuse anything else (no path traversal).
  if (!SAFE_KEY.test(key)) throw new Error(`Invalid storage key: ${key}`);
}

/** Files in a folder (tests, simple single-server setups). Writes are atomic (temp + rename). */
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  async put(key: string, body: Buffer): Promise<void> {
    checkKey(key);
    const target = join(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.uploading`;
    await writeFile(temp, body, { mode: 0o600 });
    await rename(temp, target);
  }

  async get(key: string): Promise<Readable> {
    checkKey(key);
    return Readable.from(await readFile(join(this.root, key)));
  }

  async remove(key: string): Promise<void> {
    checkKey(key);
    await rm(join(this.root, key), { force: true });
  }

  async check(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.W_OK);
  }
}

/** Any S3-compatible service (AWS S3, MinIO, …). The bucket must not be public. */
export class S3FileStorage implements FileStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    checkKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Readable> {
    checkKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  async remove(key: string): Promise<void> {
    checkKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async check(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Creates the bucket when it does not exist yet (local development). */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}

export async function createFileStorage(
  env: <K extends keyof Env>(key: K) => Env[K],
): Promise<FileStorage> {
  if (env('STORAGE_DRIVER') === 's3') {
    const accessKeyId = env('S3_ACCESS_KEY_ID');
    const secretAccessKey = env('S3_SECRET_ACCESS_KEY');
    const client = new S3Client({
      region: env('S3_REGION'),
      endpoint: env('S3_ENDPOINT'),
      forcePathStyle: env('S3_FORCE_PATH_STYLE') === 'true',
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
    const storage = new S3FileStorage(client, env('S3_BUCKET')!);
    if (env('S3_CREATE_BUCKET') === 'true') await storage.ensureBucket();
    return storage;
  }
  return new LocalFileStorage(env('STORAGE_LOCAL_DIR'));
}
