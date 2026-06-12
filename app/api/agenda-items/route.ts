// SQL prerequisites:
// ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
// ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS title text;
// ALTER TABLE agenda_items ALTER COLUMN email_id DROP NOT NULL;
// ALTER TABLE agenda_items ALTER COLUMN topic_id DROP NOT NULL;
// ALTER TABLE agenda_items DROP CONSTRAINT IF EXISTS agenda_items_item_type_check;
// ALTER TABLE agenda_items ADD CONSTRAINT agenda_items_item_type_check CHECK (item_type IN ('email', 'topic', 'manual'));

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

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
  const workspaceId = session.workspaceId!;

  const { data: items, error } = await supabaseAdmin
    .from('agenda_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Collect IDs for batch lookups
  const emailIds = items.filter(i => i.item_type === 'email' && i.email_id).map(i => i.email_id);
  const topicIds = items.filter(i => i.item_type === 'topic' && i.topic_id).map(i => i.topic_id);

  // Batch fetch related data
  const [emailsResult, topicsResult] = await Promise.all([
    emailIds.length > 0
      ? supabaseAdmin.from('emails').select('id, subject, from_name, from_email, priority, body_text, summary, action_needed, draft_reply, edited_draft, meeting_notes').in('id', emailIds)
      : Promise.resolve({ data: [], error: null }),
    topicIds.length > 0
      ? supabaseAdmin.from('recurring_topics').select('id, name, description').in('id', topicIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const emailMap = new Map((emailsResult.data || []).map(e => [e.id, e]));
  const topicMap = new Map((topicsResult.data || []).map(t => [t.id, t]));

  const result = items.map(item => ({
    id: item.id,
    sort_order: item.sort_order,
    item_type: item.item_type,
    is_discussed: item.is_discussed,
    email_id: item.email_id,
    topic_id: item.topic_id,
    title: item.title || null,
    tags: item.tags || [],
    email: item.item_type === 'email' && item.email_id ? emailMap.get(item.email_id) || null : undefined,
    topic: item.item_type === 'topic' && item.topic_id ? topicMap.get(item.topic_id) || null : undefined,
  }));

  return NextResponse.json({ items: result });
}

export async function POST(request: NextRequest) {
  const session = await requireWorkspace();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId!;

  const body = await request.json();
  const { item_type, email_id, topic_id, title } = body;

  if (!item_type || !['email', 'topic', 'manual'].includes(item_type)) {
    return NextResponse.json({ error: 'item_type must be "email", "topic", or "manual"' }, { status: 400 });
  }
  if (item_type === 'email' && !email_id) {
    return NextResponse.json({ error: 'email_id required for email items' }, { status: 400 });
  }
  if (item_type === 'topic' && !topic_id) {
    return NextResponse.json({ error: 'topic_id required for topic items' }, { status: 400 });
  }
  if (item_type === 'manual' && !title) {
    return NextResponse.json({ error: 'title required for manual items' }, { status: 400 });
  }

  // Get max sort_order
  const { data: maxRow } = await supabaseAdmin
    .from('agenda_items')
    .select('sort_order')
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const insert: Record<string, unknown> = {
    item_type,
    sort_order: nextOrder,
    is_discussed: false,
    email_id: email_id || null,
    topic_id: topic_id || null,
    title: title || null,
    workspace_id: workspaceId,
  };

  const { data, error } = await supabaseAdmin
    .from('agenda_items')
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function PATCH(request: NextRequest) {
  const session = await requireWorkspace();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId!;

  const body = await request.json();

  // Bulk reorder: { updates: [{ id, sort_order }] }
  if (body.updates && Array.isArray(body.updates)) {
    const results = await Promise.all(
      body.updates.map((u: { id: string; sort_order: number }) =>
        supabaseAdmin.from('agenda_items').update({ sort_order: u.sort_order }).eq('id', u.id).eq('workspace_id', workspaceId)
      )
    );
    const failed = results.find(r => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // Single item update: { id, is_discussed?, email_id?, topic_id? }
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (fields.is_discussed !== undefined) updates.is_discussed = fields.is_discussed;
  if (fields.email_id !== undefined) updates.email_id = fields.email_id;
  if (fields.topic_id !== undefined) updates.topic_id = fields.topic_id;
  if (fields.sort_order !== undefined) updates.sort_order = fields.sort_order;
  if (fields.tags !== undefined) updates.tags = fields.tags;
  if (fields.title !== undefined) updates.title = fields.title;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('agenda_items')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(request: NextRequest) {
  const session = await requireWorkspace();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspaceId = session.workspaceId!;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('agenda_items')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
