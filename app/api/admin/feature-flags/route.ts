import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, sessionIsSuperAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { TESTING_FEATURES } from '@/lib/testingFeatures';

// Reads workspaces.promoted_features for the caller's active workspace
// and joins it against the TESTING_FEATURES registry. Admin-only —
// promotion is a workspace-wide action.
async function loadFeatures(workspaceId: string) {
  const { data: ws, error } = await supabaseAdmin
    .from('workspaces')
    .select('promoted_features')
    .eq('id', workspaceId)
    .single();
  if (error) throw error;
  const promoted: string[] = Array.isArray(ws?.promoted_features) ? ws.promoted_features : [];
  return TESTING_FEATURES.map(f => ({
    key: f.key,
    module: f.module,
    label: f.label,
    description: f.description,
    isLive: promoted.includes(f.key),
  }));
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!sessionIsSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!session.workspaceId) {
    return NextResponse.json({ error: 'No workspace' }, { status: 400 });
  }
  try {
    const features = await loadFeatures(session.workspaceId);
    return NextResponse.json({ features });
  } catch (err) {
    console.error('[feature-flags] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!sessionIsSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!session.workspaceId) {
    return NextResponse.json({ error: 'No workspace' }, { status: 400 });
  }
  try {
    const body = await request.json();
    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    const isLive = body?.isLive === true;
    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    if (!TESTING_FEATURES.some(f => f.key === key)) {
      return NextResponse.json({ error: 'Unknown feature key' }, { status: 400 });
    }

    // Read-modify-write rather than array_append/array_remove SQL so
    // dedup + idempotency are obvious and matches the testing_features
    // PATCH shape on the workspace-members route.
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('promoted_features')
      .eq('id', session.workspaceId)
      .single();
    const current: string[] = Array.isArray(ws?.promoted_features) ? ws.promoted_features : [];
    let next = current;
    if (isLive && !current.includes(key)) {
      next = [...current, key];
    } else if (!isLive && current.includes(key)) {
      next = current.filter(k => k !== key);
    }
    if (next !== current) {
      const { error } = await supabaseAdmin
        .from('workspaces')
        .update({ promoted_features: next })
        .eq('id', session.workspaceId);
      if (error) {
        console.error('[feature-flags] PATCH update failed:', error);
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
    }

    const features = await loadFeatures(session.workspaceId);
    return NextResponse.json({ features });
  } catch (err) {
    console.error('[feature-flags] PATCH failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
