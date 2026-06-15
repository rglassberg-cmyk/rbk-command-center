import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  try {
    const session = request.cookies.get('__session');

    if (!session?.value) {
      // API routes get a JSON 401; page routes redirect to login
      if (request.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
  } catch {
    // Cookie read failed — treat as unauthenticated
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: [
    '/((?!login|api/auth|api/webhook|api/development/sync-gifts-internal|api/development/sync-constituents-internal|api/development/backfill-gifts|api/absences/sync|api/after-school/sync|api/slack/events|api/slack/morning-briefing-internal|api/health|_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|manifest.json).*)',
  ],
};
