import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getValidGoogleToken } from '@/lib/googleToken';

export async function POST(request: NextRequest) {
  try {
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

    const { emailId } = await request.json();
    if (!emailId) {
      return NextResponse.json({ error: 'emailId required' }, { status: 400 });
    }

    // Get the email's Gmail message_id
    const { data: email, error: dbError } = await supabaseAdmin
      .from('emails')
      .select('message_id')
      .eq('id', emailId)
      .eq('workspace_id', workspaceId)
      .single();

    if (dbError || !email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    if (!email.message_id) {
      return NextResponse.json({ success: true, reason: 'No Gmail message ID' });
    }

    // Trash the message in Gmail (reversible, unlike delete)
    try {
      const gmailResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.message_id}/trash`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (!gmailResponse.ok) {
        const errorText = await gmailResponse.text();
        console.error('Gmail trash error:', errorText);
      }
    } catch (gmailError) {
      console.error('Gmail trash request failed:', gmailError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Trash email error:', error);
    return NextResponse.json({ success: true, reason: 'Internal error' });
  }
}
