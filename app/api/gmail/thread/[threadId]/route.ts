import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getValidGoogleToken } from '@/lib/googleToken';

interface GmailThreadMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  bodyType: 'html' | 'text';
  snippet: string;
}

// Recursively extract body from MIME parts
function extractBody(payload: any): { body: string; bodyType: 'html' | 'text' } {
  // If this part has a body with data, check its mimeType
  if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    if (payload.mimeType === 'text/html') {
      return { body: decoded, bodyType: 'html' };
    }
    if (payload.mimeType === 'text/plain') {
      return { body: decoded, bodyType: 'text' };
    }
  }

  // If there are parts, recurse — prefer text/html over text/plain
  if (payload.parts && payload.parts.length > 0) {
    let textResult: { body: string; bodyType: 'text' } | null = null;

    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result.body) {
        if (result.bodyType === 'html') return result;
        if (result.bodyType === 'text' && !textResult) {
          textResult = result as { body: string; bodyType: 'text' };
        }
      }
    }

    if (textResult) return textResult;
  }

  return { body: '', bodyType: 'text' };
}

// Get a header value by name (case-insensitive)
function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const header = headers?.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

// Parse a Gmail API message into our structured format
function parseMessage(msg: any): GmailThreadMessage {
  const headers = msg.payload?.headers || [];
  const dateStr = getHeader(headers, 'Date');
  let isoDate: string;
  try {
    isoDate = new Date(dateStr).toISOString();
  } catch {
    isoDate = dateStr;
  }

  const { body, bodyType } = extractBody(msg.payload || {});

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject'),
    date: isoDate,
    body,
    bodyType,
    snippet: msg.snippet || '',
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await getAuthSession();

  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json(
      { error: 'Unauthorized', status: 401 },
      { status: 401 }
    );
  }

  const accessToken = await getValidGoogleToken(session.workspaceId, session.user.email);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Google account not connected. Please sign in again.', status: 401 },
      { status: 401 },
    );
  }

  const { threadId } = await params;

  try {
    // Try fetching as a thread first
    const threadRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (threadRes.ok) {
      const threadData = await threadRes.json();
      if (threadData.messages && threadData.messages.length > 0) {
        const messages = threadData.messages
          .map(parseMessage)
          .sort((a: GmailThreadMessage, b: GmailThreadMessage) =>
            new Date(a.date).getTime() - new Date(b.date).getTime()
          );
        return NextResponse.json({ threadId: threadData.id, messages });
      }
    }

    // If thread fetch failed or returned no messages, try as a message ID
    // to get the real threadId, then fetch that thread
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${threadId}?format=metadata&metadataHeaders=Subject`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!msgRes.ok) {
      const errData = await msgRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error?.message || 'Gmail API error', status: msgRes.status },
        { status: msgRes.status }
      );
    }

    const msgData = await msgRes.json();
    const realThreadId = msgData.threadId;

    if (!realThreadId || realThreadId === threadId) {
      // Already tried this thread ID — return error
      return NextResponse.json(
        { error: 'Thread not found', status: 404 },
        { status: 404 }
      );
    }

    // Fetch the real thread
    const realThreadRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${realThreadId}?format=full`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!realThreadRes.ok) {
      const errData = await realThreadRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error?.message || 'Gmail API error', status: realThreadRes.status },
        { status: realThreadRes.status }
      );
    }

    const realThreadData = await realThreadRes.json();
    const messages = (realThreadData.messages || [])
      .map(parseMessage)
      .sort((a: GmailThreadMessage, b: GmailThreadMessage) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );

    return NextResponse.json({ threadId: realThreadData.id, messages });

  } catch (error: any) {
    console.error('Gmail thread fetch error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal error', status: 500 },
      { status: 500 }
    );
  }
}
