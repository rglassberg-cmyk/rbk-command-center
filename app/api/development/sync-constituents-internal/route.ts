import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { syncConstituentsForWorkspace } from '@/lib/syncConstituents';

// Cloud Function entry point — same shared-secret auth shape as
// sync-gifts-internal. Called nightly after gifts sync completes.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-internal-secret');
  const expectedSecret = process.env.INTERNAL_SYNC_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = request.headers.get('x-workspace-id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspace ID' }, { status: 400 });
  }

  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('id, modules')
      .eq('id', workspaceId)
      .single();
    if (!ws) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    if (ws.modules?.development !== true) {
      return NextResponse.json({ error: 'Development module not enabled' }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: 'Workspace lookup failed' }, { status: 500 });
  }

  try {
    const result = await syncConstituentsForWorkspace(workspaceId);
    return NextResponse.json({
      success: true,
      count: result.count,
      constituentCount: result.constituentCount,
      studentCount: result.studentCount,
      last_sync_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SYNC CONSTITUENTS INTERNAL] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
