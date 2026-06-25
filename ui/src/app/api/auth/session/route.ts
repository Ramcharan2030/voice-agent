import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { shouldUseSecureCookies } from '@/lib/auth/cookies';

const OSS_TOKEN_COOKIE = 'voice_console_auth_token';
const OSS_USER_COOKIE = 'voice_console_auth_user';

export async function POST(request: NextRequest) {
  const { token, user } = await request.json();

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const secure = shouldUseSecureCookies(request);

  cookieStore.set(OSS_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  cookieStore.set(OSS_USER_COOKIE, JSON.stringify(user), {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  return NextResponse.json({ success: true });
}
