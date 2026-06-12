import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules, hasSubPermission } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// GET /api/development/israel-fund/raised-cache
//
// Editor-only list of every raised_cache row for the active workspace
// — INCLUDING is_excluded = true rows. Used by the "Show hidden"
// toggle in IsraelFundTab so editors can review and restore hidden
// initiatives. The public Israel Fund route filters excluded rows out;
// this endpoint is the editor-only escape hatch.

const EMILY_EMAIL = 'egray@saracademy.org';
const BECCA_EMAIL = 'rglassberg@saracademy.org';

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  // Module gating
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.development === false) {
      return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 });
    }
  } catch { /* fail open */ }

  // Editor gate — mirrors the `canEditGrants` rule in IsraelFundTab.tsx.
  const callerEmail = session.user.email.toLowerCase();
  const isEditor =
    hasSubPermission(session.allowedModules ?? null, 'development', 'israel_fund_editor') ||
    callerEmail === EMILY_EMAIL ||
    callerEmail === BECCA_EMAIL ||
    session.role === 'owner';
  if (!isEditor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from('israel_fund_raised_cache')
    .select('id, event_name, raised, manual_raised, manual_raised_note, gift_count, seed_raised, is_excluded, last_updated')
    .eq('workspace_id', wsId)
    .order('is_excluded', { ascending: true })
    .order('raised', { ascending: false });
  if (error) {
    console.error('[raised-cache GET] query failed:', error);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
