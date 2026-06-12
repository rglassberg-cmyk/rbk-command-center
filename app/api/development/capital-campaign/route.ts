// Returns Capital Campaign gifts from gifts_cache. Phase: 6-fix batch.
// Mirrors the simpler tabs (Cooper, Israel) — just filter by fund name.

import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

const CAPITAL_CAMPAIGN_FUND = 'Capital Campaign';

interface CapitalGift {
  constituent_id: number | null;
  constituent_name: string | null;
  date: string;
  amount: number;
  event: string | null;
  fundraising_activity: string | null;
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  // Module gate — same as the other dev tabs
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

  const { data, error } = await supabaseAdmin
    .from('gifts_cache')
    .select('constituent_id, constituent_name, date, amount, event, fundraising_activity')
    .eq('workspace_id', wsId)
    .eq('fund', CAPITAL_CAMPAIGN_FUND)
    .order('date', { ascending: false });

  if (error) {
    console.error('[capital-campaign] query failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  const gifts = (data ?? []) as CapitalGift[];
  const totalRaised = gifts.reduce((sum, g) => sum + Number(g.amount ?? 0), 0);
  const donorIds = new Set(gifts.map(g => g.constituent_id).filter(Boolean));

  return NextResponse.json({
    fund: CAPITAL_CAMPAIGN_FUND,
    totalRaised,
    giftCount: gifts.length,
    donorCount: donorIds.size,
    gifts,
  });
}
