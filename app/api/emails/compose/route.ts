import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getValidGoogleToken } from '@/lib/googleToken';
import { getSenderIdentity } from '@/lib/emailIdentity';

function createMimeMessage(
  to: string,
  subject: string,
  body: string,
  identity: { fromEmail: string; fromName: string; signatureHtml: string },
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
    `Subject: ${subject}`,
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

  // Per-user access token via user_google_tokens (auto-refreshes).
  // session.accessToken is the legacy short-lived token from the
  // Firebase popup; retired in Phase C.
  const accessToken = await getValidGoogleToken(workspaceId, session.user.email);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Google account not connected. Please sign in again.' },
      { status: 401 },
    );
  }

  const identity = await getSenderIdentity(workspaceId, session.user.email);

  const { to, subject, body } = await request.json();

  if (!to || !subject || !body) {
    return NextResponse.json(
      { error: 'to, subject, and body are required' },
      { status: 400 }
    );
  }

  const rawMessage = createMimeMessage(to, subject, body, identity);

  try {
    const gmailResponse = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: rawMessage }),
      }
    );

    if (!gmailResponse.ok) {
      const errorData = await gmailResponse.json();
      console.error('Gmail API error (compose):', errorData);
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to send email' },
        { status: gmailResponse.status }
      );
    }

    const sentMessage = await gmailResponse.json();

    return NextResponse.json({
      success: true,
      messageId: sentMessage.id,
    });
  } catch (error) {
    console.error('Error sending composed email:', error);
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    );
  }
}
