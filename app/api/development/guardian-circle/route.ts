import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { buildFundsFromGifts, type FundSummary } from '../fundraising-goals/route';

const GIFT_TYPE_DONATION = 1;
const GIFT_TYPE_PLEDGE = 2;
const FY_CAMPAIGN = 'Operating 2025-2026';
const GUARDIAN_CIRCLE_FUND = 'OP: Guardian Circle';
const CAPITAL_CAMPAIGN_FUND = 'Capital Campaign';

// Allowed values for the `role` pill on the Guardian Circle row and
// sidebar. Mirrors the shape of `Constituent.role` in
// fundraising-goals/route.ts (which gets widened to include
// 'Parents of Alumni' as part of this enrichment).
type Role = 'Parent' | 'Grandparent' | 'Parents of Alumni' | 'Alumni' | 'Faculty' | 'Other';

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

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

  const url = new URL(request.url);
  const view = url.searchParams.get('view');

  // Summary mode — paginated aggregation. We deliberately bypass the
  // `guardian_circle_summary` RPC here because its `donor_count` column
  // counts orgs (Smith Family Foundation, DAFs, etc.) alongside the
  // individual donor who gives through them, inflating the headline
  // number by ~50%. If the RPC is revived, it must add the same
  // `primary_development_role != 'Organization'` filter to its donor
  // count CTE — until then, the manual path is canonical. totalRaised
  // and outstandingTotal still include org dollars (those gifts are
  // real money, just not counted toward the "donors" metric).
  if (view === 'summary') {
    let totalRaised = 0;
    const donorSetNonOrg = new Set<number>();
    let totalOutstanding = 0;
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('constituent_id, amount, pledge_balance, gift_type, primary_development_role')
        .eq('workspace_id', wsId)
        .eq('fund', GUARDIAN_CIRCLE_FUND)
        .in('gift_type', [GIFT_TYPE_DONATION, GIFT_TYPE_PLEDGE])
        .eq('fundraising_activity', FY_CAMPAIGN)
        .or('soft_credit_type.is.null,soft_credit_type.eq.0')
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data) {
        totalRaised += Number(r.amount || 0);
        if (r.primary_development_role !== 'Organization') {
          donorSetNonOrg.add(r.constituent_id);
        }
        if (r.gift_type === GIFT_TYPE_PLEDGE) totalOutstanding += Number(r.pledge_balance || 0);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return NextResponse.json({
      totalRaised,
      outstandingTotal: totalOutstanding,
      donorCount: donorSetNonOrg.size,
    });
  }

  const collected: Parameters<typeof buildFundsFromGifts>[0] = [];
  let from = 0;
  const pageSize = 1000;
  try {
    while (true) {
      // Exclude soft-credit derivative records (only count the hard credit /
      // primary record per gift). Defensive — in practice gift_type 1/2 rows
      // already carry soft_credit_type = 0 since soft credits are gift_type 3/5.
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('id, gift_type, constituent_id, constituent_name, date, amount, fund, apply_to_pledge, pledge_balance, thank_you_letter_date, payment_frequency, primary_development_role, soft_credit_type, anonymous')
        .eq('workspace_id', wsId)
        .eq('fund', GUARDIAN_CIRCLE_FUND)
        .in('gift_type', [GIFT_TYPE_DONATION, GIFT_TYPE_PLEDGE])
        .eq('fundraising_activity', FY_CAMPAIGN)
        .or('soft_credit_type.is.null,soft_credit_type.eq.0')
        .order('date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        console.error('[GUARDIAN CIRCLE] Query failed:', error);
        return NextResponse.json({ error: 'Failed to load gifts' }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      collected.push(...(data as typeof collected));
      if (data.length < pageSize) break;
      from += pageSize;
    }
  } catch (err) {
    console.error('[GUARDIAN CIRCLE] Exception:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const funds = buildFundsFromGifts(collected);
  const guardianCircle: FundSummary = funds[0] || {
    fund: GUARDIAN_CIRCLE_FUND,
    totalRaised: 0,
    giftCount: 0,
    constituents: [],
  };

  let asOf = new Date().toISOString();
  try {
    const { data: meta } = await supabaseAdmin
      .from('gifts_sync_meta')
      .select('last_sync_at')
      .eq('workspace_id', wsId)
      .single();
    if (meta?.last_sync_at) asOf = meta.last_sync_at;
  } catch { /* non-fatal */ }

  // Donor count excludes orgs so the headline number reflects unique
  // donor *units* — Smith Family Foundation + John Smith count once,
  // not twice. Org constituents still appear in the `constituents`
  // list because the table is useful for staff review; only the
  // headline metric is filtered. See summary-mode comment above.
  const donorCount = guardianCircle.constituents.filter(c => c.constituentType !== 'organization').length;

  // Big Bold Future capital totals per constituent — second query
  // against gifts_cache. Kept separate from the GC aggregation since
  // BBF is a distinct fund and the totals span multiple fiscal years
  // (capital campaign pledges don't reset annually). Hard-credit only
  // and same soft-credit-exclusion filter as the GC query for
  // consistency.
  const bbfByConstituent = new Map<number, number>();
  try {
    let bbfFrom = 0;
    const bbfPageSize = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('constituent_id, amount')
        .eq('workspace_id', wsId)
        .eq('fund', CAPITAL_CAMPAIGN_FUND)
        .in('gift_type', [GIFT_TYPE_DONATION, GIFT_TYPE_PLEDGE])
        .or('soft_credit_type.is.null,soft_credit_type.eq.0')
        .range(bbfFrom, bbfFrom + bbfPageSize - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data) {
        const id = r.constituent_id;
        if (id == null) continue;
        bbfByConstituent.set(id, (bbfByConstituent.get(id) || 0) + Number(r.amount || 0));
      }
      if (data.length < bbfPageSize) break;
      bbfFrom += bbfPageSize;
    }
  } catch (err) {
    console.error('[GUARDIAN CIRCLE] BBF query failed (non-fatal):', err);
  }

  // Pull role + grades from constituents_cache (populated by
  // syncConstituentsForWorkspace). The cache may be empty if the sync
  // hasn't run yet — in that case every constituent falls back to
  // 'Other' with empty grades, identical to the Sprint 4 inert
  // behavior. Batched lookup by constituent_id; one query for the
  // whole GC set.
  const constituentIds = guardianCircle.constituents
    .map(c => Number(c.donorId))
    .filter(n => Number.isFinite(n));

  const cacheByConstituent = new Map<number, { role: Role; grades: number[] }>();
  if (constituentIds.length > 0) {
    try {
      const { data, error } = await supabaseAdmin
        .from('constituents_cache')
        .select('constituent_id, role, grades')
        .eq('workspace_id', wsId)
        .in('constituent_id', constituentIds);
      if (error) {
        console.error('[GUARDIAN CIRCLE] constituents_cache query failed:', error);
      } else if (data) {
        for (const r of data) {
          // `role` is stored as free text — narrow to the Role union
          // and fall back to 'Other' if a row drifts off the canonical
          // set (e.g. a future parser tweak that hasn't backfilled).
          const allowed: Role[] = ['Parent', 'Grandparent', 'Parents of Alumni', 'Alumni', 'Faculty', 'Other'];
          const role: Role = (allowed as string[]).includes(r.role) ? (r.role as Role) : 'Other';
          cacheByConstituent.set(r.constituent_id, {
            role,
            grades: Array.isArray(r.grades) ? r.grades : [],
          });
        }
      }
    } catch (e) {
      console.error('[GUARDIAN CIRCLE] constituents_cache lookup failed (non-fatal):', e);
    }
  }

  const enrichedConstituents = guardianCircle.constituents.map(c => {
    const cached = cacheByConstituent.get(Number(c.donorId));
    const role: Role = cached?.role ?? 'Other';
    const grades = cached?.grades ?? [];
    return {
      ...c,
      bbfTotal: bbfByConstituent.get(Number(c.donorId)) || 0,
      role,
      grades,
      agingOut: grades.includes(8),
    };
  });

  return NextResponse.json({
    fund: guardianCircle.fund,
    totalRaised: guardianCircle.totalRaised,
    donorCount,
    outstandingTotal: enrichedConstituents.reduce((s, c) => s + c.outstanding, 0),
    constituents: enrichedConstituents,
    asOf,
  });
}
