import { describe, expect, it } from 'vitest';
import { STATIC_SECURITY_HEADERS } from '../../next.config.mjs';
import { contentSecurityPolicy } from './security-headers';

describe('contentSecurityPolicy', () => {
  it('allows only nonce scripts and forbids framing, plugins and base changes', () => {
    const csp = contentSecurityPolicy('abc123');
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('allows eval and websockets in development only (hot reload)', () => {
    const csp = contentSecurityPolicy('n', true);
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws:");
  });

  it('sets the static headers', () => {
    const keys = STATIC_SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining(['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']),
    );
  });
});
