// Google Tasks OAuth callback. Receives ?code= + ?state= (the user's
// email from the consent step), exchanges the code for tokens, and
// persists the refresh_token onto the user's workspace_members row.
// Mirrors the gmail-callback pattern but writes to
// `google_tasks_refresh_token` instead of `gmail_refresh_token`.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://rbk-cmd-center.web.app';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const redirectUri = process.env.GOOGLE_TASKS_REDIRECT_URI || `${APP_URL}/api/google-tasks-callback`;

  if (error) {
    return NextResponse.redirect(`${APP_URL}/home?tasks_error=1&reason=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/home?tasks_error=1&reason=missing_code_or_state`);
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error('[GoogleTasksCallback] Token exchange failed:', tokens);
      return NextResponse.redirect(`${APP_URL}/home?tasks_error=1&reason=${encodeURIComponent(tokens.error_description || tokens.error || 'token_exchange_failed')}`);
    }

    if (!tokens.refresh_token) {
      // Google didn't re-issue a refresh_token. The `prompt: consent`
      // param on the auth route should prevent this, but if the user
      // had previously authorized the same client and revoked at the
      // browser level rather than at Google's permissions page, the
      // server may still skip the refresh_token. Surface a clear hint.
      console.warn('[GoogleTasksCallback] No refresh_token in response — user likely needs to revoke + retry');
      return NextResponse.redirect(`${APP_URL}/home?tasks_error=1&reason=no_refresh_token_revoke_and_retry`);
    }

    // Locate the workspace_members row by email (case-insensitive).
    // We deliberately do not filter by workspace_id — a member only
    // exists in one workspace at a time in the current SAR setup, and
    // this keeps the callback resilient if `state` ever loses the
    // workspace context.
    const { data: memberRow, error: lookupErr } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .ilike('email', state.trim())
      .limit(1)
      .maybeSingle();

    if (lookupErr || !memberRow) {
      console.error('[GoogleTasksCallback] member lookup failed for state=', state, lookupErr);
      return NextResponse.redirect(`${APP_URL}/home?tasks_error=1&reason=member_not_found`);
    }

    const { error: updateErr } = await supabaseAdmin
      .from('workspace_members')
      .update({ google_tasks_refresh_token: tokens.refresh_token })
      .eq('id', memberRow.id);

    if (updateErr) {
      console.error('[GoogleTasksCallback] Failed to save token:', updateErr);
      return NextResponse.redirect(`${APP_URL}/home?tasks_error=1&reason=db_write_failed`);
    }

    return NextResponse.redirect(`${APP_URL}/home?tasks_connected=1`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    console.error('[GoogleTasksCallback] threw:', err);
    return NextResponse.redirect(`${APP_URL}/home?tasks_error=1&reason=${encodeURIComponent(message)}`);
  }
}
