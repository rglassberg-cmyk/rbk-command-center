import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

interface ProjectUpdateRow {
  id: string;
  workspace_id: string;
  project_id: string;
  text: string;
  author: string;
  created_at: string;
}

async function getContext() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;
  return { wsId, email: session.user.email };
}

export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if ('error' in ctx) return ctx.error;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');

  let q = supabaseAdmin
    .from('project_updates')
    .select('*')
    .eq('workspace_id', ctx.wsId)
    .order('created_at', { ascending: false });
  if (projectId) q = q.eq('project_id', projectId);

  const { data, error } = await q;
  if (error) {
    console.error('[PROJECT UPDATES] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load updates' }, { status: 500 });
  }
  return NextResponse.json({ updates: (data ?? []) as ProjectUpdateRow[] });
}

export async function POST(request: NextRequest) {
  const ctx = await getContext();
  if ('error' in ctx) return ctx.error;

  let body: { project_id?: string; text?: string; author?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.project_id || !body.text?.trim()) {
    return NextResponse.json({ error: 'project_id and text required' }, { status: 400 });
  }

  // Author defaults to the caller's email local-part if not provided.
  const author = body.author?.trim() || ctx.email.split('@')[0];

  const { data, error } = await supabaseAdmin
    .from('project_updates')
    .insert({
      workspace_id: ctx.wsId,
      project_id: body.project_id,
      text: body.text.trim(),
      author,
    })
    .select()
    .single();

  if (error) {
    console.error('[PROJECT UPDATES] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create update' }, { status: 500 });
  }
  return NextResponse.json({ update: data as ProjectUpdateRow }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const ctx = await getContext();
  if ('error' in ctx) return ctx.error;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('project_updates')
    .delete()
    .eq('id', id)
    .eq('workspace_id', ctx.wsId);

  if (error) {
    console.error('[PROJECT UPDATES] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete update' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
