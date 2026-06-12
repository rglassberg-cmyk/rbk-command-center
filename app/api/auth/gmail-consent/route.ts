import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

export async function GET() {
  const session = await getAuthSession();

  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json(
      { error: 'Not authenticated or no workspace' },
      { status: 401 }
    );
  }

  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    // Read-only Sheets access — used by /api/development/cooper-fund to
    // pull live Column G disbursement totals from the Cooper Reconciliation
    // sheet. Users connected before this scope was added need to reconnect
    // via /api/auth/gmail-consent before the Sheets call can succeed.
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ].join(' ');

  // Encode user info in state so the callback knows who initiated the consent
  const stateData = {
    workspaceId: session.workspaceId,
    userEmail: session.user.email,
  };
  const state = Buffer.from(JSON.stringify(stateData)).toString('base64url');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/gmail-callback`,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}
