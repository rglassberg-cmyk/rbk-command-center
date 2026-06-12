import { supabaseAdmin } from '@/lib/supabase';

/**
 * Get a valid Google access token for a specific user in a workspace.
 * Reads from user_google_tokens, refreshes if expired.
 * Returns null if the user hasn't connected their Google account.
 */
export async function getValidGoogleToken(
  workspaceId: string,
  userEmail: string,
): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[GoogleToken] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    return null;
  }

  const { data: tokenRow, error: fetchError } = await supabaseAdmin
    .from('user_google_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('workspace_id', workspaceId)
    .eq('user_email', userEmail.toLowerCase())
    .limit(1)
    .single();

  if (fetchError || !tokenRow?.refresh_token) {
    return null; // User hasn't connected
  }

  // Check if current access_token is still valid (5-min buffer)
  if (tokenRow.access_token && tokenRow.token_expiry) {
    const expiry = new Date(tokenRow.token_expiry).getTime();
    if (expiry > Date.now() + 5 * 60 * 1000) {
      return tokenRow.access_token;
    }
  }

  // Refresh the token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('[GoogleToken] Refresh failed for', userEmail, ':', tokenRes.status, err);
    if (err.includes('invalid_grant')) {
      // Token revoked — clean up
      await supabaseAdmin
        .from('user_google_tokens')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('user_email', userEmail.toLowerCase());
    }
    return null;
  }

  const tokens = await tokenRes.json();
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  // Save the fresh access token
  await supabaseAdmin
    .from('user_google_tokens')
    .update({
      access_token: tokens.access_token,
      token_expiry: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('user_email', userEmail.toLowerCase());

  return tokens.access_token || null;
}

/**
 * Get a valid Google access token for workspace-level operations (email sync).
 * Uses the workspace's gmail_refresh_token. Falls back from per-user tokens.
 */
export async function getGoogleAccessToken(workspaceId: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const { data: workspace } = await supabaseAdmin
    .from('workspaces')
    .select('gmail_refresh_token')
    .eq('id', workspaceId)
    .single();

  if (!workspace?.gmail_refresh_token) return null;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: workspace.gmail_refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('[GoogleToken] Workspace refresh failed:', tokenRes.status, err);
    return null;
  }

  const tokens = await tokenRes.json();
  return tokens.access_token || null;
}
