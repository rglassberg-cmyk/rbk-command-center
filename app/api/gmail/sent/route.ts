import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

interface SentMessage {
  id: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
}

/** Recursively extract text/plain body from MIME parts, falling back to stripped HTML */
function extractTextBody(payload: any): string {
  if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    if (payload.mimeType === 'text/plain') return decoded;
    if (payload.mimeType === 'text/html') return stripHtml(decoded);
  }

  if (payload.parts && payload.parts.length > 0) {
    let htmlFallback = '';
    for (const part of payload.parts) {
      const result = extractTextBody(part);
      if (result) {
        // If we got it from a text/plain part, return immediately
        if (part.mimeType === 'text/plain' || (part.parts && result)) return result;
        if (!htmlFallback) htmlFallback = result;
      }
    }
    if (htmlFallback) return htmlFallback;
  }

  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const header = headers?.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Step 1 — Get refresh token from workspace
    const { data: workspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select('gmail_refresh_token')
      .eq('id', session.workspaceId)
      .single();

    if (wsError || !workspace?.gmail_refresh_token) {
      console.error('No refresh token found:', wsError?.message || 'token missing');
      return NextResponse.json({ error: 'No Gmail refresh token configured' }, { status: 500 });
    }

    // Step 2 — Exchange refresh token for access token
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

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
      console.error('Token refresh failed:', await tokenRes.text());
      return NextResponse.json({ error: 'Failed to refresh Gmail token' }, { status: 500 });
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;

    // Step 3 — Fetch sent messages using workspace owner's token
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=50',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const listData = await listRes.json();

    if (listData.error) {
      return NextResponse.json({ error: listData.error.message }, { status: 500 });
    }

    const messageIds: Array<{ id: string }> = listData.messages || [];
    if (messageIds.length === 0) {
      return NextResponse.json({ messages: [] });
    }

    // Fetch all messages in parallel
    const results = await Promise.all(
      messageIds.map(async ({ id }): Promise<SentMessage | null> => {
        try {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const msg = await msgRes.json();
          if (msg.error) return null;

          const headers = msg.payload?.headers || [];
          const dateStr = getHeader(headers, 'Date');
          let isoDate: string;
          try { isoDate = new Date(dateStr).toISOString(); } catch { isoDate = dateStr; }

          return {
            id: msg.id,
            threadId: msg.threadId,
            subject: getHeader(headers, 'Subject'),
            to: getHeader(headers, 'To'),
            date: isoDate,
            snippet: msg.snippet || '',
            body: extractTextBody(msg.payload || {}),
          };
        } catch {
          return null;
        }
      })
    );

    const messages = results.filter((m): m is SentMessage => m !== null);
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('Gmail sent fetch error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
