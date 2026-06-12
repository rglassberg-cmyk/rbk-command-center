import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

async function requireWorkspace() {
  const session = await getAuthSession();
  if (!session?.user?.email) return null;
  if (!session.workspaceId) return null;
  return session;
}

export async function GET() {
  const session = await requireWorkspace();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = await getEffectiveWorkspaceId(session) || session.workspaceId!;

  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('workspace_id', workspaceId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching projects:', error);
      return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
    }

    return NextResponse.json({ projects: data || [] });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireWorkspace();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId!;

  try {
    const { title, description, department, priority, assignee, due_date, assignee_email, team_emails } = await request.json();

    if (!title || !department) {
      return NextResponse.json({ error: 'Title and department are required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({
        title,
        description: description || null,
        department,
        priority: priority || 'medium',
        status: 'active',
        progress: 0,
        assignee: assignee || 'rbk',
        due_date: due_date || null,
        assignee_email: assignee_email || null,
        team_emails: team_emails || [],
        workspace_id: workspaceId,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating project:', error);
      return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
    }

    return NextResponse.json({ project: data });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireWorkspace();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId!;

  try {
    const { id, ...fields } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== undefined) updates.description = fields.description;
    if (fields.department !== undefined) updates.department = fields.department;
    if (fields.priority !== undefined) updates.priority = fields.priority;
    if (fields.status !== undefined) updates.status = fields.status;
    if (fields.progress !== undefined) updates.progress = fields.progress;
    if (fields.assignee !== undefined) updates.assignee = fields.assignee;
    if (fields.due_date !== undefined) updates.due_date = fields.due_date;
    if (fields.links !== undefined) updates.links = fields.links;
    // SQL: ALTER TABLE projects ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
    if (fields.tags !== undefined) updates.tags = fields.tags;
    if (fields.assignee_email !== undefined) updates.assignee_email = fields.assignee_email;
    if (fields.team_emails !== undefined) updates.team_emails = fields.team_emails;

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) {
      console.error('Error updating project:', error);
      return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
    }

    return NextResponse.json({ project: data });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireWorkspace();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId!;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('projects')
      .update({ status: 'archived' })
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) {
      console.error('Error archiving project:', error);
      return NextResponse.json({ error: 'Failed to archive project' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
