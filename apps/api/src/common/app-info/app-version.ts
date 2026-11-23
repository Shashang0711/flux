import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * API version from apps/api/package.json. Read at runtime because the file sits outside
 * the compiled rootDir; src/common/app-info and dist/common/app-info are both 3 levels deep.
 */
export const APP_VERSION: string = (
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;
