import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getValidGoogleToken } from '@/lib/googleToken';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // Get the email from database to find the Gmail message ID
    const { data: email, error: dbError } = await supabaseAdmin
      .from('emails')
      .select('message_id')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (dbError || !email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    if (!email.message_id) {
      // No Gmail message ID, just return success (email may have been created locally)
      return NextResponse.json({ success: true, archived: false, reason: 'No Gmail message ID' });
    }

    // Archive in Gmail by removing INBOX label
    const gmailResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.message_id}/modify`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          removeLabelIds: ['INBOX'],
        }),
      }
    );

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text();
      console.error('Gmail archive error:', errorText);
      // Don't fail the request - the email is still marked done in our system
      return NextResponse.json({
        success: true,
        archived: false,
        reason: 'Gmail API error',
        details: errorText
      });
    }

    return NextResponse.json({ success: true, archived: true });
  } catch (error) {
    console.error('Archive error:', error);
    return NextResponse.json({ error: 'Failed to archive' }, { status: 500 });
  }
}
