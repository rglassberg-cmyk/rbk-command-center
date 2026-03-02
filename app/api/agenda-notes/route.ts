import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const emailId = searchParams.get('emailId');
  const type = searchParams.get('type');

  let query = supabase.from('agenda_notes').select('*');

  if (emailId) {
    query = query.eq('email_id', emailId);
  }
  if (type) {
    query = query.eq('type', type);
  }

  if (!emailId && !type) {
    return NextResponse.json({ error: 'emailId or type required' }, { status: 400 });
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email_id, text, type, assignee } = body;
  if (!email_id || !text || !type) {
    return NextResponse.json({ error: 'email_id, text, and type are required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('agenda_notes')
    .insert({ email_id, text, type, assignee: assignee || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}

export async function PATCH(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await request.json();
  const updates: Record<string, string | null> = {};
  if (body.type !== undefined) updates.type = body.type;
  if (body.assignee !== undefined) updates.assignee = body.assignee;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('agenda_notes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('agenda_notes')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
