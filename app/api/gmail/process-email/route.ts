import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getValidGoogleToken } from '@/lib/googleToken';

const LABEL_NAME = 'RBK/Done';

async function getOrCreateLabel(accessToken: string): Promise<string | null> {
  try {
    // List existing labels to find RBK/Done
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels',
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!listRes.ok) {
      console.error('Failed to list Gmail labels:', await listRes.text());
      return null;
    }

    const { labels } = await listRes.json();
    const existing = labels?.find((l: { name: string; id: string }) => l.name === LABEL_NAME);
    if (existing) return existing.id;

    // Create the label
    const createRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: LABEL_NAME,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        }),
      }
    );

    if (!createRes.ok) {
      console.error('Failed to create Gmail label:', await createRes.text());
      return null;
    }

    const created = await createRes.json();
    return created.id;
  } catch (error) {
    console.error('Error getting/creating Gmail label:', error);
    return null;
  }
}

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
      return NextResponse.json({ success: true, processed: false, reason: 'No Gmail message ID' });
    }

    // Get or create the RBK/Done label
    const labelId = await getOrCreateLabel(accessToken);

    // Build the modify request — always remove INBOX, add label if available
    const addLabelIds: string[] = [];
    if (labelId) addLabelIds.push(labelId);
    const removeLabelIds = ['INBOX'];

    const gmailResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.message_id}/modify`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ addLabelIds, removeLabelIds }),
      }
    );

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text();
      console.error('Gmail modify error:', errorText);
      // Don't fail — the task/send action should still succeed
      return NextResponse.json({ success: true, processed: false, reason: 'Gmail API error' });
    }

    return NextResponse.json({ success: true, processed: true });
  } catch (error) {
    console.error('Process email error:', error);
    // Never block the caller
    return NextResponse.json({ success: true, processed: false, reason: 'Internal error' });
  }
}
