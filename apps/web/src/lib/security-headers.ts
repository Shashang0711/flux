/**
 * The Content-Security-Policy for a page, with this request's nonce (see proxy.ts). The static
 * security headers are in next.config.mjs.
 */
export function contentSecurityPolicy(nonce: string, dev = false): string {
  return [
    `default-src 'self'`,
    // Only scripts carrying this response's nonce (and what they load). Dev needs eval for HMR.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Inline style attributes are used by components; styles cannot run code.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}
