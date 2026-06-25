import type { NextRequest } from 'next/server';

/**
 * Secure cookies are required on HTTPS, but browsers reject them on plain HTTP.
 * Coolify terminates TLS at its proxy and reports the browser protocol through
 * X-Forwarded-Proto, so use that instead of NODE_ENV.
 */
export function shouldUseSecureCookies(request: NextRequest): boolean {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',', 1)[0]
    ?.trim()
    .toLowerCase();

  if (forwardedProto) {
    return forwardedProto === 'https';
  }

  return request.nextUrl.protocol === 'https:';
}
