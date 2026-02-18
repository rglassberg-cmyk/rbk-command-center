import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

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

// Rabbi Krauss' email signature (HTML)
const EMAIL_SIGNATURE = `
<br><br>
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
  <p style="margin: 0; color: #0066cc; font-weight: bold;">Rabbi Binyamin Krauss</p>
  <p style="margin: 0; color: #0066cc;">Principal</p>
  <p style="margin: 8px 0 0 0;">
    <span style="color: #666;">p</span> | <a href="tel:7185481717" style="color: #333; text-decoration: none;">718.548.1717 ext. 1206</a>
  </p>
  <p style="margin: 0;">
    <span style="color: #666;">e</span> | <a href="mailto:kraussb@saracademy.org" style="color: #0066cc; text-decoration: none;">kraussb@saracademy.org</a>
  </p>
  <p style="margin: 4px 0 8px 0;">
    <a href="https://www.linkedin.com/in/bini-krauss/" style="color: #0066cc; text-decoration: none;">LinkedIn</a>
  </p>
  <img src="https://rbk-command-center.vercel.app/sar-logo.jpg" alt="SAR Academy" style="max-width: 200px; height: auto;">
</div>
`;

function createMimeMessage(to: string, subject: string, body: string): string {
  const fromEmail = 'kraussb@saracademy.org';
  const fromName = 'Rabbi Binyamin Krauss';

  // Convert plain text body to HTML (preserve line breaks)
  const htmlBody = body.replace(/\n/g, '<br>');

  // Build HTML content with signature
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
${htmlBody}
${EMAIL_SIGNATURE}
</body>
</html>
`;

  const messageParts = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: Re: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlContent,
  ];

  const message = messageParts.join('\r\n');

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email || !session.accessToken) {
    return NextResponse.json(
      { error: 'Unauthorized or missing access token' },
      { status: 401 }
    );
  }

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

  // Fetch all emails
  const { data: emails, error: fetchError } = await supabaseAdmin
    .from('emails')
    .select('id, from_email, from_name, subject, edited_draft, draft_reply, draft_status, thread_id, message_id')
    .in('id', email_ids);

  if (fetchError) {
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    );
  }

  const results: SendResult[] = [];

  // Process each email
  for (const email of (emails as EmailRecord[])) {
    const draftContent = email.edited_draft || email.draft_reply;

    // Validate each email
    if (!draftContent) {
      results.push({ id: email.id, success: false, error: 'No draft content' });
      continue;
    }

    if (email.draft_status !== 'approved') {
      results.push({ id: email.id, success: false, error: 'Draft not approved' });
      continue;
    }

    // Create and send the message
    const rawMessage = createMimeMessage(
      email.from_email,
      email.subject,
      draftContent
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
            'Authorization': `Bearer ${session.accessToken}`,
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

      // Update the email record
      await supabaseAdmin
        .from('emails')
        .update({
          status: 'done',
          action_status: 'sent',
          sent_at: new Date().toISOString(),
          sent_by: session.user.email,
          sent_message_id: sentMessage.id,
        })
        .eq('id', email.id);

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

  // Check for any emails not found
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
