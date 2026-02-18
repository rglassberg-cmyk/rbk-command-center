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

// Create a MIME message for Gmail API (HTML format with signature)
function createMimeMessage(to: string, subject: string, body: string, threadId?: string | null): string {
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

  // Build MIME message with HTML content type
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

  // Encode to base64url (Gmail API requirement)
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return encodedMessage;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email || !session.accessToken) {
    return NextResponse.json(
      { error: 'Unauthorized or missing access token' },
      { status: 401 }
    );
  }

  const { id } = await params;

  // Get the email record from database
  const { data: email, error: fetchError } = await supabaseAdmin
    .from('emails')
    .select('id, from_email, from_name, subject, edited_draft, draft_reply, draft_status, thread_id, message_id')
    .eq('id', id)
    .single();

  if (fetchError || !email) {
    return NextResponse.json(
      { error: 'Email not found' },
      { status: 404 }
    );
  }

  const typedEmail = email as EmailRecord;

  // Get the draft content (prefer edited draft over original)
  const draftContent = typedEmail.edited_draft || typedEmail.draft_reply;

  if (!draftContent) {
    return NextResponse.json(
      { error: 'No draft content to send' },
      { status: 400 }
    );
  }

  // Check if draft is approved
  if (typedEmail.draft_status !== 'approved') {
    return NextResponse.json(
      { error: 'Draft must be approved before sending' },
      { status: 400 }
    );
  }

  // Create MIME message
  const rawMessage = createMimeMessage(
    typedEmail.from_email,
    typedEmail.subject,
    draftContent,
    typedEmail.thread_id
  );

  try {
    // Build the Gmail API request body
    const requestBody: { raw: string; threadId?: string } = {
      raw: rawMessage,
    };

    // If we have a thread ID, include it to keep the conversation threaded
    if (typedEmail.thread_id) {
      requestBody.threadId = typedEmail.thread_id;
    }

    // Send via Gmail API
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
      console.error('Gmail API error:', errorData);

      // Handle specific errors
      if (gmailResponse.status === 403) {
        return NextResponse.json(
          { error: 'Permission denied. Make sure you have Send As permissions for kraussb@saracademy.org' },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to send email' },
        { status: gmailResponse.status }
      );
    }

    const sentMessage = await gmailResponse.json();

    // Update the email record to mark as sent
    const { error: updateError } = await supabaseAdmin
      .from('emails')
      .update({
        status: 'done',
        action_status: 'sent',
        sent_at: new Date().toISOString(),
        sent_by: session.user.email,
        sent_message_id: sentMessage.id,
      })
      .eq('id', id);

    if (updateError) {
      console.error('Error updating email status:', updateError);
      // Email was sent but status update failed - not critical
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
