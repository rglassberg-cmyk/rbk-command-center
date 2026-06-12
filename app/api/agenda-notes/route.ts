import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { sendTaskSlack } from '@/lib/slackNotifications';
import { normalizeToCapitalized } from '@/lib/assignees';

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'No workspace' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const emailId = searchParams.get('emailId');
  const type = searchParams.get('type');

  const agendaItemId = searchParams.get('agenda_item_id');

  let query = supabaseAdmin.from('agenda_notes').select('*').eq('workspace_id', workspaceId);

  if (emailId) {
    query = query.eq('email_id', emailId);
  }
  if (type) {
    query = query.eq('type', type);
  }
  if (agendaItemId) {
    query = query.eq('agenda_item_id', agendaItemId);
  }

  if (!emailId && !type && !agendaItemId) {
    return NextResponse.json({ error: 'emailId, type, or agenda_item_id required' }, { status: 400 });
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Phase B: shim removed. Assignee is now returned in its canonical
  // Capitalized form ('RBK', 'Emily', ...). Clients compare against
  // currentMember.assigneeKey case-insensitively where needed.
  return NextResponse.json({ notes: data ?? [] });
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

  const body = await request.json();
  const { email_id, text, type, assignee, meeting_date, agenda_item_id } = body;
  if (!text || !type) {
    return NextResponse.json({ error: 'text and type are required' }, { status: 400 });
  }
  if (!email_id && !agenda_item_id && type !== 'action') {
    return NextResponse.json({ error: 'email_id or agenda_item_id required' }, { status: 400 });
  }

  const insert: Record<string, unknown> = {
    text,
    type,
    assignee: normalizeToCapitalized(assignee) ?? null,
    meeting_date: meeting_date || new Date().toISOString().split('T')[0],
    workspace_id: workspaceId,
  };
  if (email_id) insert.email_id = email_id;
  if (agenda_item_id) insert.agenda_item_id = agenda_item_id;

  const { data, error } = await supabaseAdmin
    .from('agenda_notes')
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire the generic "📌 New task assigned to you" DM for action items
  // that have an assignee. Non-action notes (meeting notes etc.) and
  // unassigned notes are silently skipped. Helper is case-insensitive so
  // legacy lowercase ('rbk' / 'emily') resolves the same as the Capitalized
  // forms used by the tasks-table flows.
  if (data?.assignee && data.type === 'action') {
    void sendTaskSlack(workspaceId, data.assignee, { title: data.text, source: 'manual' });
  }

  return NextResponse.json({ note: data });
}

export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'No workspace' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await request.json();
  const updates: Record<string, string | boolean | null> = {};
  if (body.type !== undefined) updates.type = body.type;
  if (body.assignee !== undefined) updates.assignee = body.assignee == null ? null : (normalizeToCapitalized(body.assignee) ?? null);
  if (body.text !== undefined) updates.text = body.text;
  if (body.completed !== undefined) updates.completed = body.completed;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  // If the assignee is being changed, read the prior value so we only DM
  // on a genuine reassignment (not a no-op PATCH).
  let priorAssignee: string | null = null;
  if (body.assignee !== undefined) {
    const { data: prior } = await supabaseAdmin
      .from('agenda_notes')
      .select('assignee')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();
    priorAssignee = prior?.assignee ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from('agenda_notes')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (
    data?.assignee &&
    data.type === 'action' &&
    body.assignee !== undefined &&
    data.assignee !== priorAssignee
  ) {
    void sendTaskSlack(workspaceId, data.assignee, { title: data.text, source: 'manual' });
  }

  return NextResponse.json({ note: data });
}

export async function DELETE(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'No workspace' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('agenda_notes')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
