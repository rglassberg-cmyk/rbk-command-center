import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

const CASH_GIFT_TYPE_CODES = new Set([1, 3]);

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const effectiveWsId = await getEffectiveWorkspaceId(session) || session.workspaceId;
  const constituentId = new URL(request.url).searchParams.get('constituentId');

  if (!constituentId) {
    return NextResponse.json({ error: 'constituentId required' }, { status: 400 });
  }

  try {
    // Fetch all gifts for this constituent
    const collected: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('*')
        .eq('workspace_id', effectiveWsId)
        .eq('constituent_id', parseInt(constituentId))
        .order('date', { ascending: false })
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      collected.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }

    // Filter + dedup
    let gifts = collected.filter((g: any) => CASH_GIFT_TYPE_CODES.has(g.gift_type));
    gifts = gifts.filter((g: any) => !g.in_kind_gift_description || g.in_kind_gift_description.trim() === '');
    const groups = new Map<number, any[]>();
    for (const g of gifts) {
      const rootId = g.hard_credit_gift_id ?? g.id;
      const arr = groups.get(rootId) || [];
      arr.push(g);
      groups.set(rootId, arr);
    }
    const deduped: any[] = [];
    for (const [, group] of groups) {
      if (group.length === 1) { deduped.push(group[0]); }
      else { deduped.push(group.find((g: any) => g.soft_credit_type === 1) || group[0]); }
    }

    // Group by fiscal year (Jul 1 - Jun 30)
    const getFiscalYear = (dateStr: string): string => {
      const d = new Date(dateStr + 'T00:00:00');
      const month = d.getMonth(); // 0-indexed
      const year = d.getFullYear();
      return month >= 6 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
    };

    const yearMap = new Map<string, { total: number; gifts: any[] }>();
    let totalGiving = 0;

    for (const g of deduped) {
      const fy = getFiscalYear(g.date?.split('T')[0] || g.date || '2025-01-01');
      const entry = yearMap.get(fy) || { total: 0, gifts: [] };
      entry.total += g.amount;
      entry.gifts.push({
        id: g.id,
        date: g.date,
        amount: g.amount,
        event: g.event,
        fund: g.fund,
        gift_type: g.gift_type,
        isPledgePayment: g.apply_to_pledge === true,
        isSoftCredit: g.soft_credit_type === 1,
      });
      yearMap.set(fy, entry);
      totalGiving += g.amount;
    }

    const giftsByYear = [...yearMap.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, data]) => ({ year, total: data.total, gifts: data.gifts }));

    const name = deduped[0]?.constituent_name || 'Unknown';

    return NextResponse.json({
      donor: {
        name,
        constituentId: parseInt(constituentId),
        totalGiving,
        giftsByYear,
      },
    });
  } catch (error) {
    console.error('[DONOR HISTORY] Error:', error);
    return NextResponse.json({ error: 'Failed to load donor history' }, { status: 500 });
  }
}
