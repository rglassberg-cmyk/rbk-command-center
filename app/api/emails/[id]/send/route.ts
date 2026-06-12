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

function createMimeMessage(
  to: string,
  subject: string,
  body: string,
  identity: SenderIdentity,
): string {
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;

  const { data: email, error: fetchError } = await supabaseAdmin
    .from('emails')
    .select('id, from_email, from_name, subject, edited_draft, draft_reply, draft_status, thread_id, message_id')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();

  if (fetchError || !email) {
    return NextResponse.json(
      { error: 'Email not found' },
      { status: 404 }
    );
  }

  const typedEmail = email as EmailRecord;
  const draftContent = typedEmail.edited_draft || typedEmail.draft_reply;

  if (!draftContent) {
    return NextResponse.json(
      { error: 'No draft content to send' },
      { status: 400 }
    );
  }

  const rawMessage = createMimeMessage(
    typedEmail.from_email,
    typedEmail.subject,
    draftContent,
    identity,
  );

  try {
    const requestBody: { raw: string; threadId?: string } = { raw: rawMessage };
    if (typedEmail.thread_id) {
      requestBody.threadId = typedEmail.thread_id;
    }

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
      console.error('Gmail API error:', errorData);

      if (gmailResponse.status === 403) {
        return NextResponse.json(
          { error: `Permission denied. Make sure you have Send As permissions for ${identity.fromEmail}` },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to send email' },
        { status: gmailResponse.status }
      );
    }

    const sentMessage = await gmailResponse.json();

    const { error: updateError } = await supabaseAdmin
      .from('emails')
      .update({
        status: 'done',
        action_status: 'sent',
        sent_at: new Date().toISOString(),
        sent_by: session.user.email,
        sent_message_id: sentMessage.id,
      })
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (updateError) {
      console.error('Error updating email status:', updateError);
    }

    return NextResponse.json({
      success: true,
      message: 'Email sent successfully',
      gmail_message_id: sentMessage.id,
    });

  } catch (error) {
    console.error('Error sending email:', error);
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    );
  }
}
