import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// SQL to create app_state table in Supabase:
//
// CREATE TABLE IF NOT EXISTS app_state (
//   id TEXT PRIMARY KEY,
//   value TEXT NOT NULL,
//   updated_at TIMESTAMPTZ DEFAULT NOW()
// );

const HISTORY_ID_KEY = 'gmail_last_history_id';

// Get a fresh access token for RBK's Gmail from the active session cookie
// Since this webhook fires server-side with no user session, we store
// RBK's refresh token in Supabase app_state and use it to get access tokens.
// ALTERNATIVE: Use a service account with domain-wide delegation.
//
// For now, we use the Google OAuth refresh token flow.
async function getGmailAccessToken(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('app_state')
    .select('value')
    .eq('id', 'gmail_refresh_token')
    .single();

  if (!data?.value) {
    console.error('No Gmail refresh token stored in app_state');
    return null;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    return null;
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: data.value,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      console.error('Token refresh failed:', await res.text());
      return null;
    }

    const tokens = await res.json();
    return tokens.access_token;
  } catch (error) {
    console.error('Token refresh error:', error);
    return null;
  }
}

async function getLastHistoryId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('app_state')
    .select('value')
    .eq('id', HISTORY_ID_KEY)
    .single();

  return data?.value || null;
}

async function saveHistoryId(historyId: string): Promise<void> {
  await supabaseAdmin
    .from('app_state')
    .upsert({ id: HISTORY_ID_KEY, value: historyId, updated_at: new Date().toISOString() });
}

export async function POST(request: NextRequest) {
  try {
    // Parse Pub/Sub envelope
    const body = await request.json();
    const messageData = body?.message?.data;

    if (!messageData) {
      console.error('Gmail push: no message.data in payload');
      // Return 200 so Pub/Sub doesn't retry
      return NextResponse.json({ status: 'no_data' });
    }

    // Decode base64 payload -> { emailAddress, historyId }
    const decoded = JSON.parse(Buffer.from(messageData, 'base64').toString('utf-8'));
    const { historyId } = decoded;

    if (!historyId) {
      return NextResponse.json({ status: 'no_history_id' });
    }

    console.log(`Gmail push notification: historyId=${historyId}`);

    // Get last processed historyId
    const lastHistoryId = await getLastHistoryId();

    if (!lastHistoryId) {
      // First time — just store the historyId and return
      console.log('First push notification — storing initial historyId');
      await saveHistoryId(historyId);
      return NextResponse.json({ status: 'initialized', historyId });
    }

    // Get an access token for Gmail API
    const accessToken = await getGmailAccessToken();
    if (!accessToken) {
      console.error('Cannot get Gmail access token — skipping');
      return NextResponse.json({ status: 'no_token' });
    }

    // Fetch history since lastHistoryId
    const historyUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
    historyUrl.searchParams.set('startHistoryId', lastHistoryId);
    historyUrl.searchParams.set('historyTypes', 'labelRemoved');
    historyUrl.searchParams.set('historyTypes', 'messageDeleted');
    historyUrl.searchParams.set('labelId', 'INBOX');

    const historyRes = await fetch(historyUrl.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!historyRes.ok) {
      const errorText = await historyRes.text();
      // 404 means historyId is too old — reset to current
      if (historyRes.status === 404) {
        console.log('History ID too old, resetting to current');
        await saveHistoryId(historyId);
        return NextResponse.json({ status: 'history_reset' });
      }
      console.error('Gmail history API error:', historyRes.status, errorText);
      return NextResponse.json({ status: 'history_error' });
    }

    const historyData = await historyRes.json();

    // Save the new historyId BEFORE processing (so we don't reprocess on retry)
    await saveHistoryId(historyId);

    if (!historyData.history) {
      // No changes since last check
      return NextResponse.json({ status: 'no_changes' });
    }

    // Collect message IDs that were archived (INBOX label removed) or deleted
    const archivedMessageIds = new Set<string>();

    for (const record of historyData.history) {
      // labelsRemoved: messages where INBOX was removed (= archived)
      if (record.labelsRemoved) {
        for (const item of record.labelsRemoved) {
          const removedLabels = item.labelIds || [];
          if (removedLabels.includes('INBOX')) {
            archivedMessageIds.add(item.message.id);
          }
        }
      }

      // messagesDeleted: permanently deleted messages
      if (record.messagesDeleted) {
        for (const item of record.messagesDeleted) {
          archivedMessageIds.add(item.message.id);
        }
      }
    }

    if (archivedMessageIds.size === 0) {
      return NextResponse.json({ status: 'no_archives' });
    }

    console.log(`Gmail push: ${archivedMessageIds.size} message(s) archived/deleted`);

    // Mark matching emails as 'done' in Supabase
    const messageIdArray = Array.from(archivedMessageIds);
    const { data: updated, error } = await supabaseAdmin
      .from('emails')
      .update({ status: 'done' })
      .in('message_id', messageIdArray)
      .neq('status', 'done')
      .select('id, message_id');

    if (error) {
      console.error('Supabase update error:', error);
    } else if (updated && updated.length > 0) {
      console.log(`Marked ${updated.length} email(s) as done:`, updated.map(e => e.message_id));
    }

    return NextResponse.json({
      status: 'processed',
      archived: messageIdArray.length,
      updated: updated?.length || 0,
    });

  } catch (error) {
    console.error('Gmail push webhook error:', error);
    // Always return 200 to prevent Pub/Sub retries on application errors
    return NextResponse.json({ status: 'error' });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Gmail push webhook endpoint is ready',
  });
}
