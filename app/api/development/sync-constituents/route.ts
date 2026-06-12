import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { syncConstituentsForWorkspace } from '@/lib/syncConstituents';

export async function POST() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const effectiveWsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  // Module gating — same shape as sync-gifts.
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', effectiveWsId)
      .single();
    if (ws?.modules?.development === false) {
      return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 });
    }
  } catch { /* fail open */ }

  try {
    const result = await syncConstituentsForWorkspace(effectiveWsId);
    return NextResponse.json({
      success: true,
      count: result.count,
      constituentCount: result.constituentCount,
      studentCount: result.studentCount,
      synced_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SYNC CONSTITUENTS] Route error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
