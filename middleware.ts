import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    // Protect all routes except these
    '/((?!login|api/auth|api/webhook|api/health|_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|manifest.json).*)',
  ],
};
