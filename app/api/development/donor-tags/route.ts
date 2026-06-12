import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// Predefined tags. The client uses TAG_DEFS for the dropdown; this server
// list is an allowlist so arbitrary strings can't be persisted. The
// stored hex color is the historical contract — admissions pills render
// via Tailwind classes on the client side regardless of what's stored
// here, so the hex values for admissions labels are chosen to roughly
// match their Tailwind tint family (amber/red/purple/blue/slate).
const TAG_DEFS: Record<string, string> = {
  // Development tags
  'Needs Follow-Up': '#f59e0b',
  'Major Donor': '#8b5cf6',
  'Lapsed': '#ef4444',
  'Pledged Verbally': '#3b82f6',
  'Thank You Sent': '#10b981',
  // Admissions tags (added 2026-05-24)
  'Needs Follow-up': '#f59e0b',
  'Application Incomplete': '#ef4444',
  'Scholarship': '#8b5cf6',
  'Priority Family': '#3b82f6',
  'Decision Pending': '#64748b',
};

interface DonorTag {
  id: string;
  workspace_id: string;
  constituent_name: string;
  constituent_id: string | null;
  tag: string;
  color: string;
  created_by: string;
  created_at: string;
}

async function getEffectiveWs() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.development === false) {
      return { error: NextResponse.json({ error: 'Module not enabled' }, { status: 403 }) };
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return { error: NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 }) };
    }
  } catch { /* fail open */ }
  return { wsId, email: session.user.email };
}

export async function GET(request: NextRequest) {
  const ctx = await getEffectiveWs();
  if ('error' in ctx) return ctx.error;

  const url = new URL(request.url);
  const constituentName = url.searchParams.get('constituent_name');

  let q = supabaseAdmin
    .from('donor_tags')
    .select('*')
    .eq('workspace_id', ctx.wsId)
    .order('created_at', { ascending: true });
  if (constituentName) q = q.eq('constituent_name', constituentName);

  const { data, error } = await q;
  if (error) {
    console.error('[DONOR TAGS] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load tags' }, { status: 500 });
  }
  return NextResponse.json({ tags: (data ?? []) as DonorTag[] });
}

export async function POST(request: NextRequest) {
  const ctx = await getEffectiveWs();
  if ('error' in ctx) return ctx.error;

  let body: { constituent_name?: string; constituent_id?: string | null; tag?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.constituent_name || !body.tag) {
    return NextResponse.json({ error: 'constituent_name and tag required' }, { status: 400 });
  }
  const color = TAG_DEFS[body.tag];
  if (!color) {
    return NextResponse.json({ error: `Unknown tag "${body.tag}"` }, { status: 400 });
  }

  // Upsert on (workspace_id, constituent_name, tag) — no duplicates.
  const { data, error } = await supabaseAdmin
    .from('donor_tags')
    .upsert(
      {
        workspace_id: ctx.wsId,
        constituent_name: body.constituent_name,
        constituent_id: body.constituent_id ?? null,
        tag: body.tag,
        color,
        created_by: ctx.email,
      },
      { onConflict: 'workspace_id,constituent_name,tag' },
    )
    .select()
    .single();

  if (error) {
    console.error('[DONOR TAGS] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
  return NextResponse.json({ tag: data as DonorTag }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const ctx = await getEffectiveWs();
  if ('error' in ctx) return ctx.error;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('donor_tags')
    .delete()
    .eq('id', id)
    .eq('workspace_id', ctx.wsId);

  if (error) {
    console.error('[DONOR TAGS] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
