import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const effectiveWsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  try {
    const { gift_id, note } = await request.json();

    if (!gift_id || typeof note !== 'string') {
      return NextResponse.json({ error: 'gift_id and note are required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('gift_notes')
      .upsert(
        {
          gift_id: String(gift_id),
          workspace_id: effectiveWsId,
          author_email: session.user.email, // Always the real author
          note,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'gift_id,workspace_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[GIFT NOTES] Upsert error:', error);
      return NextResponse.json({ error: 'Failed to save note' }, { status: 500 });
    }

    return NextResponse.json({ success: true, note: data });
  } catch (error) {
    console.error('[GIFT NOTES] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const effectiveWsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  try {
    const { searchParams } = new URL(request.url);
    const giftId = searchParams.get('gift_id');

    if (!giftId) {
      return NextResponse.json({ error: 'gift_id is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('gift_notes')
      .delete()
      .eq('gift_id', giftId)
      .eq('workspace_id', effectiveWsId);

    if (error) {
      console.error('[GIFT NOTES] Delete error:', error);
      return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[GIFT NOTES] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
