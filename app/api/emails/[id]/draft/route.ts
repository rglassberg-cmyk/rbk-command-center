import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { edited_draft, draft_status } = body;

  const updateData: Record<string, unknown> = {
    draft_edited_by: session.user.email,
    draft_edited_at: new Date().toISOString(),
  };

  if (edited_draft !== undefined) {
    updateData.edited_draft = edited_draft;
  }

  if (draft_status) {
    updateData.draft_status = draft_status;
  }

  const { data, error } = await supabaseAdmin
    .from('emails')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating draft:', error);
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 });
  }

  return NextResponse.json(data);
}
