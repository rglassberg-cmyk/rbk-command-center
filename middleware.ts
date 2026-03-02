import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const session = request.cookies.get('__session');

  if (!session?.value) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|api/auth|api/webhook|api/health|_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|manifest.json).*)',
  ],
};
