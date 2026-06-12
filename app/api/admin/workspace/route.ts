import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

// Admin endpoint for workspace-level settings (currently just the
// workspace name; will grow to include branding, integrations, etc.).
// Phase F (SaaS self-service) will move this beyond ADMIN_EMAIL gating
// to a workspace-owner check.

const ADMIN_EMAIL = 'rglassberg@saracademy.org';

function gate(email?: string | null): NextResponse | null {
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (email.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  const blocked = gate(session?.user?.email);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const wsId = url.searchParams.get('id') || session?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('workspaces')
    .select('id, name')
    .eq('id', wsId)
    .single();
  if (error) {
    console.error('Admin: workspace GET error:', error);
    return NextResponse.json({ error: 'Failed to load workspace' }, { status: 500 });
  }
  return NextResponse.json({ workspace: data });
}

export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  const blocked = gate(session?.user?.email);
  if (blocked) return blocked;

  let body: { id?: string; name?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const wsId = body.id || session?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    updates.name = trimmed;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('workspaces')
    .update(updates)
    .eq('id', wsId);
  if (error) {
    console.error('Admin: workspace PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
