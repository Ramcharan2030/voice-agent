import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    enabled: Boolean(process.env.SENTRY_DSN),
    dsn: process.env.SENTRY_DSN || '',
    environment: process.env.NODE_ENV || 'development',
  });
}
