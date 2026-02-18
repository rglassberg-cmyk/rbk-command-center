import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, action_status } = body;

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
      const validActionStatuses = ['send', 'sent', 'notify_emily', 'remind_me', 'escalate_emily', 'draft_ready', 'urgent', null];
      if (!validActionStatuses.includes(action_status)) {
        return NextResponse.json(
          { error: 'Invalid action status' },
          { status: 400 }
        );
      }
      updateData.action_status = action_status;
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
