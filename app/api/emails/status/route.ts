import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, action_status, draft_status, reminder_date, revision_comment, priority } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing id' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = { is_unread: false };

    // Handle regular status update
    if (status !== undefined) {
      const validStatuses = ['pending', 'in_progress', 'done', 'archived'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: 'Invalid status' },
          { status: 400 }
        );
      }
      updateData.status = status;
    }

    // Handle action status update
    if (action_status !== undefined) {
      const validActionStatuses = ['send', 'sent', 'remind_me', 'draft_ready', 'urgent', null];
      if (!validActionStatuses.includes(action_status)) {
        return NextResponse.json(
          { error: 'Invalid action status' },
          { status: 400 }
        );
      }
      updateData.action_status = action_status;
    }

    // Handle draft status update
    if (draft_status !== undefined) {
      const validDraftStatuses = ['not_started', 'editing', 'draft_ready', 'approved', 'needs_revision', null];
      if (!validDraftStatuses.includes(draft_status)) {
        return NextResponse.json(
          { error: 'Invalid draft status' },
          { status: 400 }
        );
      }
      updateData.draft_status = draft_status;
    }

    // Handle reminder date
    if (reminder_date !== undefined) {
      updateData.reminder_date = reminder_date;
    }

    // Handle revision comment
    if (revision_comment !== undefined) {
      updateData.revision_comment = revision_comment;
    }

    // Handle priority change (for moving to Emily's queue)
    if (priority !== undefined) {
      const validPriorities = ['rbk_action', 'eg_action', 'important_no_action', 'review', 'invitation', 'fyi'];
      if (!validPriorities.includes(priority)) {
        return NextResponse.json(
          { error: 'Invalid priority' },
          { status: 400 }
        );
      }
      updateData.priority = priority;
    }

    const { data, error } = await supabaseAdmin
      .from('emails')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to update status' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, email: data });
  } catch (error) {
    console.error('Error updating status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
