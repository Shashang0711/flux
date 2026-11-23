import argon2 from 'argon2';

// argon2id with the library defaults (64 MiB, t=3, p=4) — above the OWASP minimum.
const OPTIONS = { type: argon2.argon2id } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time as a real verification. Used when the email is unknown so response
 * timing does not reveal which accounts exist.
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword('flux-dummy-password-for-timing');
  await verifyPassword(await dummyHash, plain);
}
