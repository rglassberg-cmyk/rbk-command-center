import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken } from '@/lib/firebase-admin';

const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken } = await request.json();

    if (!idToken) {
      return NextResponse.json({ error: 'Missing ID token' }, { status: 400 });
    }

    // Verify Firebase ID token via REST API
    const firebaseUser = await verifyIdToken(idToken);
    const email = firebaseUser.email?.toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'No email in token' }, { status: 400 });
    }

    // Check against allowed emails
    if (allowedEmails.length === 0) {
      return NextResponse.json({ error: 'No allowed emails configured' }, { status: 403 });
    }

    if (!allowedEmails.includes(email)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Build session payload
    const sessionData = JSON.stringify({
      idToken,
      accessToken: accessToken || null,
      user: {
        email: firebaseUser.email,
        name: firebaseUser.displayName || null,
        image: firebaseUser.photoUrl || null,
      },
    });

    // Set __session cookie (Firebase Hosting only forwards this cookie name)
    const response = NextResponse.json({ success: true });
    response.cookies.set('__session', sessionData, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour (matches Google access token lifetime)
    });

    return response;
  } catch (error) {
    console.error('Session creation error:', error);
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
