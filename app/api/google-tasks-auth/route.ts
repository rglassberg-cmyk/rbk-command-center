// Initiates the Google Tasks OAuth flow for the currently signed-in
// member. Mirrors the gmail-consent pattern at /api/auth/gmail-consent
// but with a narrower scope (`tasks` only) and a separate redirect URI
// so the Google client can be configured with both callbacks. The
// refresh token persisted by the callback enables /api/development/donor-notes
// to push a matching item to the assignee's Google Tasks list when they
// are @mentioned.

import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://rbk-cmd-center.web.app';

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Redirect URI is configurable so non-prod environments can use a
  // different callback; falls back to the prod URL composed from
  // NEXT_PUBLIC_APP_URL. Either way, the URI must be in the Google
  // Cloud Console's authorized redirect URIs list for the OAuth client.
  const redirectUri = process.env.GOOGLE_TASKS_REDIRECT_URI || `${APP_URL}/api/google-tasks-callback`;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/tasks',
    access_type: 'offline',
    // `prompt: consent` forces Google to re-issue a refresh_token even
    // if the user has previously authorized this client — otherwise
    // re-consenting silently returns only an access_token and we can't
    // persist long-term access.
    prompt: 'consent',
    state: session.user.email,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
