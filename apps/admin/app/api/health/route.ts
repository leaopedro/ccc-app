import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export const GET = () =>
  NextResponse.json({
    status: 'ok',
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    uptimeSeconds: Math.round(process.uptime()),
  });
