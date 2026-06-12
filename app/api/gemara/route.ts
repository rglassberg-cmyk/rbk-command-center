// Run this SQL in Supabase SQL Editor:
//
// CREATE TABLE IF NOT EXISTS gemara_items (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   type TEXT NOT NULL DEFAULT 'note',
//   title TEXT NOT NULL,
//   url TEXT,
//   body TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

async function requireWorkspace() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) return null;
  return session;
}

export async function GET() {
  const session = await requireWorkspace();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.modules?.gemara === false) {
    return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
  }
  const workspaceId = session.workspaceId!;

  try {
    const { data, error } = await supabaseAdmin
      .from('gemara_items')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching gemara items:', error);
      return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
    }

    return NextResponse.json({ items: data || [] });
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
  if (session.modules?.gemara === false) {
    return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
  }
  const workspaceId = session.workspaceId!;

  try {
    const { type, title, url, body } = await request.json();

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('gemara_items')
      .insert({
        type: type || 'note',
        title,
        url: url || null,
        body: body || null,
        workspace_id: workspaceId,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating gemara item:', error);
      return NextResponse.json({ error: 'Failed to create item' }, { status: 500 });
    }

    return NextResponse.json({ item: data });
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
  if (session.modules?.gemara === false) {
    return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
  }
  const workspaceId = session.workspaceId!;

  try {
    const { id, title, url, body } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const updates: Record<string, string | null> = {};
    if (title !== undefined) updates.title = title;
    if (url !== undefined) updates.url = url || null;
    if (body !== undefined) updates.body = body || null;

    const { data, error } = await supabaseAdmin
      .from('gemara_items')
      .update(updates)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) {
      console.error('Error updating gemara item:', error);
      return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
    }

    return NextResponse.json({ item: data });
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
  if (session.modules?.gemara === false) {
    return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
  }
  const workspaceId = session.workspaceId!;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('gemara_items')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) {
      console.error('Error deleting gemara item:', error);
      return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
