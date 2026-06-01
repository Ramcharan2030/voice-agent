/*
  Route to enable/ disable posthog from a NextJS backend route,
  rather than NEXT_PUBLIC_* keys, since NEXT_PUBLIC_* keys are
  injected during build time, and we need to provide the option
  to OSS users to disable telemetry from docker-compose.yaml
*/
import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.POSTHOG_KEY || '';
  const host = process.env.POSTHOG_HOST || '';
  return NextResponse.json({
    enabled: process.env.ENABLE_TELEMETRY === 'true' && Boolean(key && host),
    key,
    host,
    uiHost: process.env.POSTHOG_UI_HOST || '',
  });
}
