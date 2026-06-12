import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/home?gmailConnected=false&error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${appUrl}/home?gmailConnected=false&error=${encodeURIComponent('Missing authorization code or state')}`
    );
  }

  // Decode state — supports both new JSON format and legacy (plain workspaceId)
  let workspaceId: string;
  let userEmail: string | null = null;
  try {
    const decoded = Buffer.from(stateParam, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded);
    workspaceId = parsed.workspaceId;
    userEmail = parsed.userEmail || null;
  } catch {
    // Legacy: state is just the workspaceId string
    workspaceId = stateParam;
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${appUrl}/api/auth/gmail-callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return NextResponse.redirect(
        `${appUrl}/home?gmailConnected=false&error=${encodeURIComponent(tokens.error_description || tokens.error || 'Token exchange failed')}`
      );
    }

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${appUrl}/home?gmailConnected=false&error=${encodeURIComponent('No refresh token returned. Revoke access at myaccount.google.com/permissions and try again.')}`
      );
    }

    const tokenExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    const scopes = tokens.scope || '';

    // Save per-user token to user_google_tokens
    if (userEmail) {
      const { error: upsertError } = await supabaseAdmin
        .from('user_google_tokens')
        .upsert({
          workspace_id: workspaceId,
          user_email: userEmail.toLowerCase(),
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: tokenExpiry,
          scopes,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,user_email' });

      if (upsertError) {
        console.error('[GmailCallback] Failed to save user token:', upsertError.message);
      }
    }

    // Also update the workspace-level token for the email-sync Cloud
    // Function. This token is org-wide (one per workspace) so we only
    // overwrite it when the connecting user is an owner of the
    // workspace — preventing a non-owner's re-consent from clobbering
    // the principal's sync token. Replaces the legacy hardcoded
    // WORKSPACE_OWNER_EMAIL = 'kraussb@…' check.
    if (userEmail) {
      const { data: ownerRow } = await supabaseAdmin
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspaceId)
        .ilike('email', userEmail.trim())
        .eq('role', 'owner')
        .maybeSingle();

      if (ownerRow) {
        const { error: dbError } = await supabaseAdmin
          .from('workspaces')
          .update({ gmail_refresh_token: tokens.refresh_token })
          .eq('id', workspaceId);

        if (dbError) {
          console.error('[GmailCallback] Failed to save workspace token:', dbError.message);
        }
      }
    }

    return NextResponse.redirect(`${appUrl}/home?gmailConnected=true`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.redirect(
      `${appUrl}/home?gmailConnected=false&error=${encodeURIComponent(message)}`
    );
  }
}
