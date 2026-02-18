import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('important_docs')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching important docs:', error);
      return NextResponse.json({ error: 'Failed to fetch docs' }, { status: 500 });
    }

    return NextResponse.json({ docs: data || [] });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { title, url } = await request.json();

    if (!title || !url) {
      return NextResponse.json({ error: 'Title and URL are required' }, { status: 400 });
    }

    // Get max sort_order
    const { data: maxData } = await supabaseAdmin
      .from('important_docs')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = (maxData?.[0]?.sort_order || 0) + 1;

    const { data, error } = await supabaseAdmin
      .from('important_docs')
      .insert({ title, url, sort_order: nextOrder })
      .select()
      .single();

    if (error) {
      console.error('Error creating doc:', error);
      return NextResponse.json({ error: 'Failed to create doc' }, { status: 500 });
    }

    return NextResponse.json({ doc: data });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('important_docs')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting doc:', error);
      return NextResponse.json({ error: 'Failed to delete doc' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
