import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectFileKind } from '@flux/shared';
import { LocalFileStorage, type FileStorage } from './storage';

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe('detectFileKind', () => {
  it('recognises files by their content', () => {
    expect(detectFileKind(text('%PDF-1.7\n'), 'report.PDF')).toBe('pdf');
    expect(detectFileKind(text('%PDF-1.4'), 'renamed.txt')).toBe('pdf');
    expect(detectFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'a.png')).toBe(
      'png',
    );
    expect(detectFileKind(bytes(0xff, 0xd8, 0xff, 0xe0), 'photo.jpg')).toBe('jpeg');
    expect(detectFileKind(bytes(0x50, 0x4b, 0x03, 0x04), 'results.xlsx')).toBe('xlsx');
    expect(detectFileKind(text('sample,org_50\n'), 'results.csv')).toBe('csv');
  });

  it('rejects files whose content does not match an accepted kind', () => {
    expect(detectFileKind(text('<html>'), 'report.pdf')).toBeNull();
    expect(detectFileKind(bytes(0x50, 0x4b, 0x03, 0x04), 'archive.zip')).toBeNull();
    expect(detectFileKind(bytes(0x4d, 0x5a, 0x00, 0x01), 'results.csv')).toBeNull(); // binary
  });
});

describe('LocalFileStorage', () => {
  let dir: string;
  const key = '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flux-storage-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('stores and reads files by key', async () => {
    const storage: FileStorage = new LocalFileStorage(dir);
    await storage.put(key, Buffer.from('hello'), 'text/plain');
    expect(await readFile(join(dir, key), 'utf8')).toBe('hello');
    const chunks: Buffer[] = [];
    for await (const c of await storage.get(key)) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  it('refuses keys that are not tenant/file ids (no path traversal)', async () => {
    const storage: FileStorage = new LocalFileStorage(dir);
    await expect(storage.put('../etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(storage.get(`${key}/../../x`)).rejects.toThrow(/Invalid storage key/);
  });
});
