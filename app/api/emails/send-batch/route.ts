import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getValidGoogleToken } from '@/lib/googleToken';
import { getSenderIdentity, type SenderIdentity } from '@/lib/emailIdentity';

interface EmailRecord {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  edited_draft: string | null;
  draft_reply: string | null;
  draft_status: string | null;
  thread_id: string | null;
  message_id: string | null;
}

interface SendResult {
  id: string;
  success: boolean;
  error?: string;
  gmail_message_id?: string;
}

function createMimeMessage(to: string, subject: string, body: string, identity: SenderIdentity): string {
  const htmlBody = body.replace(/\n/g, '<br>');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
${htmlBody}
${identity.signatureHtml}
</body>
</html>
`;

  const messageParts = [
    `From: ${identity.fromName} <${identity.fromEmail}>`,
    `To: ${to}`,
    `Subject: Re: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlContent,
  ];

  return Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'No workspace' }, { status: 401 });
  }

  const accessToken = await getValidGoogleToken(workspaceId, session.user.email);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Google account not connected. Please sign in again.' },
      { status: 401 },
    );
  }

  const identity = await getSenderIdentity(workspaceId, session.user.email);

  const body = await request.json();
  const { email_ids } = body;

  if (!email_ids || !Array.isArray(email_ids) || email_ids.length === 0) {
    return NextResponse.json(
      { error: 'email_ids array is required' },
      { status: 400 }
    );
  }

  if (email_ids.length > 20) {
    return NextResponse.json(
      { error: 'Maximum 20 emails can be sent at once' },
      { status: 400 }
    );
  }

  const { data: emails, error: fetchError } = await supabaseAdmin
    .from('emails')
    .select('id, from_email, from_name, subject, edited_draft, draft_reply, draft_status, thread_id, message_id')
    .in('id', email_ids)
    .eq('workspace_id', workspaceId);

  if (fetchError) {
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    );
  }

  const results: SendResult[] = [];

  for (const email of (emails as EmailRecord[])) {
    const draftContent = email.edited_draft || email.draft_reply;

    if (!draftContent) {
      results.push({ id: email.id, success: false, error: 'No draft content' });
      continue;
    }

    const rawMessage = createMimeMessage(
      email.from_email,
      email.subject,
      draftContent,
      identity,
    );

    const requestBody: { raw: string; threadId?: string } = { raw: rawMessage };
    if (email.thread_id) {
      requestBody.threadId = email.thread_id;
    }

    try {
      const gmailResponse = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!gmailResponse.ok) {
        const errorData = await gmailResponse.json();
        results.push({
          id: email.id,
          success: false,
          error: errorData.error?.message || 'Gmail API error',
        });
        continue;
      }

      const sentMessage = await gmailResponse.json();

      await supabaseAdmin
        .from('emails')
        .update({
          status: 'done',
          action_status: 'sent',
          sent_at: new Date().toISOString(),
          sent_by: session.user.email,
          sent_message_id: sentMessage.id,
        })
        .eq('id', email.id)
        .eq('workspace_id', workspaceId);

      results.push({
        id: email.id,
        success: true,
        gmail_message_id: sentMessage.id,
      });

    } catch (error) {
      results.push({
        id: email.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const foundIds = emails?.map(e => e.id) || [];
  for (const id of email_ids) {
    if (!foundIds.includes(id)) {
      results.push({ id, success: false, error: 'Email not found' });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  return NextResponse.json({
    success: failCount === 0,
    message: `Sent ${successCount} of ${email_ids.length} emails`,
    results,
  });
}
