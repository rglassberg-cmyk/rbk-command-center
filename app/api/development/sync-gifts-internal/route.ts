import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { syncGiftsForWorkspace } from '@/lib/syncGifts';

export async function POST(request: NextRequest) {
  // Auth via shared secret (no user session — called by Cloud Function)
  const secret = request.headers.get('x-internal-secret');
  const expectedSecret = process.env.INTERNAL_SYNC_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = request.headers.get('x-workspace-id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspace ID' }, { status: 400 });
  }

  // Verify workspace exists and has development module
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
    const result = await syncGiftsForWorkspace(workspaceId);

    if (result.success) {
      return NextResponse.json({
        success: true,
        count: result.count,
        last_sync_at: new Date().toISOString(),
      });
    } else {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
  } catch (error) {
    console.error('[SYNC GIFTS INTERNAL] Error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
