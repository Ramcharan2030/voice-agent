import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { shouldUseSecureCookies } from '@/lib/auth/cookies';

const OSS_TOKEN_COOKIE = 'voice_console_auth_token';
const OSS_USER_COOKIE = 'voice_console_auth_user';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const secure = shouldUseSecureCookies(request);

  cookieStore.set(OSS_TOKEN_COOKIE, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  cookieStore.set(OSS_USER_COOKIE, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  return NextResponse.json({ success: true });
}
