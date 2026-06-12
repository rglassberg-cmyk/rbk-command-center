import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { sendTaskSlack, type SlackTask } from '@/lib/slackNotifications';
import { normalizeToCapitalized } from '@/lib/assignees';

const normalizeAssignedTo = normalizeToCapitalized;

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const projectId = url.searchParams.get('project_id');

  let q = supabaseAdmin
    .from('tasks')
    .select('id, title, description, priority, status, assigned_to, due_date, completed_at, created_at, updated_at, source, source_ref, project_id')
    .eq('workspace_id', wsId)
    .order('created_at', { ascending: false });

  if (source) q = q.eq('source', source);
  if (projectId) q = q.eq('project_id', projectId);

  const { data, error } = await q;
  if (error) {
    console.error('[TASKS] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
  }
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  let body: {
    title?: string;
    description?: string;
    assigned_to?: string;
    due_date?: string;
    priority?: string;
    source?: string;
    source_ref?: string;
    project_id?: string;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }
  if (!body.assigned_to) {
    return NextResponse.json({ error: 'assigned_to required' }, { status: 400 });
  }
  const normalizedAssignee = normalizeAssignedTo(body.assigned_to);
  console.log('[tasks POST] assigned_to value:', body.assigned_to, '→ normalized:', normalizedAssignee);

  const row = {
    workspace_id: wsId,
    title: body.title.trim(),
    description: body.description ?? null,
    assigned_to: normalizedAssignee,
    due_date: body.due_date ?? null,
    priority: body.priority ?? 'medium',
    status: 'todo',
    source: body.source ?? 'manual',
    source_ref: body.source_ref ?? null,
    project_id: body.project_id ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from('tasks')
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error('[TASKS] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }

  // Fire-and-forget assignment DM. Failures already logged inside
  // helper. actorEmail enables self-assignment skip (don't DM yourself).
  if (data?.assigned_to) {
    void sendTaskSlack(
      wsId,
      data.assigned_to,
      { title: data.title, source: data.source, due_date: data.due_date, notes: data.description },
      session.user.email,
    );
  }

  return NextResponse.json({ task: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  let body: {
    id?: string;
    status?: string;
    assigned_to?: string | null;
    due_date?: string | null;
    title?: string;
    description?: string | null;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // If assigned_to is being changed, read the prior value first so we only
  // fire the Slack DM when the assignee actually changes (not on a no-op
  // PATCH that just re-asserts the same value).
  let priorAssignedTo: string | null = null;
  let dmTaskShape: SlackTask | null = null;
  if (body.assigned_to !== undefined) {
    const { data: existing } = await supabaseAdmin
      .from('tasks')
      .select('assigned_to, title, source, due_date, description')
      .eq('id', body.id)
      .eq('workspace_id', wsId)
      .single();
    if (existing) {
      priorAssignedTo = existing.assigned_to ?? null;
      dmTaskShape = {
        title: body.title ?? existing.title,
        source: existing.source,
        due_date: (body.due_date !== undefined ? body.due_date : existing.due_date) ?? null,
        notes: (body.description !== undefined ? body.description : existing.description) ?? null,
      };
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    patch.status = body.status;
    if (body.status === 'done') patch.completed_at = new Date().toISOString();
  }
  if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to == null ? null : normalizeAssignedTo(body.assigned_to);
  if (body.due_date !== undefined) patch.due_date = body.due_date;
  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;

  if (Object.keys(patch).length === 1) {
    // Only updated_at — nothing to do.
    return NextResponse.json({ success: true, noChange: true });
  }

  const { error } = await supabaseAdmin
    .from('tasks')
    .update(patch)
    .eq('id', body.id)
    .eq('workspace_id', wsId);

  if (error) {
    console.error('[TASKS] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }

  if (
    body.assigned_to !== undefined &&
    body.assigned_to !== null &&
    body.assigned_to !== priorAssignedTo &&
    dmTaskShape
  ) {
    void sendTaskSlack(wsId, body.assigned_to, dmTaskShape, session.user.email);
  }

  return NextResponse.json({ success: true });
}
