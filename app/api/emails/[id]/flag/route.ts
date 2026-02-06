import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { flagged_for_meeting, meeting_notes } = body;

  const updateData: Record<string, unknown> = {};

  if (flagged_for_meeting !== undefined) {
    updateData.flagged_for_meeting = flagged_for_meeting;
    if (flagged_for_meeting) {
      updateData.flagged_by = session.user.email;
      updateData.flagged_at = new Date().toISOString();
    } else {
      updateData.flagged_by = null;
      updateData.flagged_at = null;
    }
  }

  if (meeting_notes !== undefined) {
    updateData.meeting_notes = meeting_notes;
  }

  const { data, error } = await supabaseAdmin
    .from('emails')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating flag:', error);
    return NextResponse.json({ error: 'Failed to update flag' }, { status: 500 });
  }

  return NextResponse.json(data);
}
