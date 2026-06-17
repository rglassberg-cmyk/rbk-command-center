import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { classifySegment } from '../route';

// GET /api/development/overview/segment-donors?segment=Parent
//
// Drill-down for the Development Overview segment cards. Returns every
// FY26 Operating donor in the requested segment, with their received /
// pledged / total split. Uses the EXACT same classification as the
// overview route (imported `classifySegment`) so the donor list always
// reconciles with the card totals.
//
// Filters mirror the overview route:
//   fundraising_activity = 'Operating 2025-2026', gift_type IN (1,2,3).
// donationsReceived per constituent = SUM(amount) on type-1 gifts when
// they gave directly, else SUM(amount) on qualifying type-3 soft credits
// (soft_credit_type 1 or 2) — soft credits GAP-FILL only, never stacking
// on a direct donor (Veracross writes a soft-credit twin for every direct
// gift, so adding both double-counts). outstandingPledges =
// SUM(pledge_balance) on type-2; total = the two combined. Grouped by
// constituent, sorted by total DESC. (2026-06-14 gap-fill spec.)

const FY26_CAMPAIGN = 'Operating 2025-2026';
const GIFT_TYPE_DONATION = 1;
const GIFT_TYPE_PLEDGE = 2;
const GIFT_TYPE_SOFT_CREDIT = 3;
const SOFT_CREDIT_TYPE_DONATION = 1;
const SOFT_CREDIT_TYPE_HOUSEHOLD = 2;

const VALID_SEGMENTS = new Set([
  'Board Members',
  'Parent',
  'Grandparent',
  'Parents of Alumni',
  'Program & Future Families',
  'Alumni',
  'Faculty',
  'Other',
]);

interface GiftRow {
  constituent_id: number | null;
  constituent_name: string | null;
  amount: number | null;
  pledge_balance: number | null;
  gift_type: number;
  soft_credit_type: number | null;
  hard_credit_gift_id: number | null;
  date: string | null;
}

interface SegmentDonor {
  constituentId: string;
  constituentName: string;
  donationsReceived: number;
  outstandingPledges: number;
  total: number;
  lastGiftDate: string | null;
  primaryDevelopmentRole: string;
  // For the Board Members drilldown only: the segment this constituent
  // would fall into if "Trustee" were removed from their roles (Parent,
  // Grandparent, etc.). null for every other segment.
  secondaryRole: string | null;
}

export async function GET(request: NextRequest) {
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

  const segment = new URL(request.url).searchParams.get('segment') ?? '';
  if (!VALID_SEGMENTS.has(segment)) {
    return NextResponse.json({ error: 'Unknown segment' }, { status: 400 });
  }

  // 1. All FY26 Operating type-1/2 gifts.
  const gifts: GiftRow[] = [];
  try {
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('constituent_id, constituent_name, amount, pledge_balance, gift_type, soft_credit_type, hard_credit_gift_id, date')
        .eq('workspace_id', wsId)
        .eq('fundraising_activity', FY26_CAMPAIGN)
        .in('gift_type', [GIFT_TYPE_DONATION, GIFT_TYPE_PLEDGE, GIFT_TYPE_SOFT_CREDIT])
        .range(from, from + pageSize - 1);
      if (error) {
        console.error('[SEGMENT-DONORS] gifts query failed:', error);
        return NextResponse.json({ error: 'Failed to load gifts' }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      gifts.push(...(data as GiftRow[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }
  } catch (err) {
    console.error('[SEGMENT-DONORS] Exception fetching gifts:', err);
    return NextResponse.json({ error: 'Failed to load gifts' }, { status: 500 });
  }

  // 2. Aggregate per constituent. Pools are kept separate so the gap-fill
  // rule can be applied after the pass (received = type1 when the donor
  // gave directly, else qualifying soft credits).
  // type1 sums ALL type-1 gift amounts (so a donor with 11 gifts shows
  // their total, not one). Soft credits dedup by hard_credit_gift_id (sc
  // 1 + 2 rows share an id) so each underlying gift counts once — and
  // multiple same-amount soft credits are NOT collapsed (the old
  // amount-dedup wrongly showed Cory Greenbaum's 11×$540 as $540).
  const byDonor = new Map<number, {
    name: string;
    type1: number;
    softKeys: Set<number | string>;
    soft: number;
    pledged: number;
    hasType1: boolean;
    hasType2: boolean;
    hasSoft: boolean;
    lastGiftDate: string | null;
  }>();
  for (const g of gifts) {
    if (g.constituent_id == null) continue;
    const isSoft = g.gift_type === GIFT_TYPE_SOFT_CREDIT &&
      (g.soft_credit_type === SOFT_CREDIT_TYPE_DONATION || g.soft_credit_type === SOFT_CREDIT_TYPE_HOUSEHOLD);
    // Skip any non-qualifying type-3 row so it doesn't create a $0 donor.
    if (g.gift_type === GIFT_TYPE_SOFT_CREDIT && !isSoft) continue;
    const cid = g.constituent_id;
    const entry = byDonor.get(cid) ?? {
      name: '', type1: 0, softKeys: new Set<number | string>(), soft: 0, pledged: 0, hasType1: false, hasType2: false, hasSoft: false, lastGiftDate: null,
    };
    if (g.constituent_name && !entry.name) entry.name = g.constituent_name;
    if (g.gift_type === GIFT_TYPE_DONATION) { entry.type1 += Number(g.amount || 0); entry.hasType1 = true; }
    else if (g.gift_type === GIFT_TYPE_PLEDGE) { entry.pledged += Number(g.pledge_balance || 0); entry.hasType2 = true; }
    else if (isSoft) {
      const softKey = g.hard_credit_gift_id ?? `amt_${Number(g.amount || 0)}`;
      if (!entry.softKeys.has(softKey)) {
        entry.softKeys.add(softKey);
        entry.soft += Number(g.amount || 0);
      }
      entry.hasSoft = true;
    }
    if (g.date && (!entry.lastGiftDate || g.date > entry.lastGiftDate)) entry.lastGiftDate = g.date;
    byDonor.set(cid, entry);
  }

  // 3. Roles for classification (chunked).
  const donorIds = Array.from(byDonor.keys());
  const roleByDonor = new Map<number, string>();
  const rolesRawByDonor = new Map<number, string>();
  try {
    const chunkSize = 500;
    for (let i = 0; i < donorIds.length; i += chunkSize) {
      const chunk = donorIds.slice(i, i + chunkSize);
      const { data, error } = await supabaseAdmin
        .from('constituents_cache')
        .select('constituent_id, role, roles_raw')
        .eq('workspace_id', wsId)
        .in('constituent_id', chunk);
      if (error) {
        console.error('[SEGMENT-DONORS] constituents_cache chunk failed:', error);
        continue;
      }
      for (const r of (data || [])) {
        roleByDonor.set(r.constituent_id, r.role || 'Other');
        if (r.roles_raw) rolesRawByDonor.set(r.constituent_id, r.roles_raw);
      }
    }
  } catch (err) {
    console.error('[SEGMENT-DONORS] constituents_cache lookup failed (non-fatal):', err);
  }

  // 4. Filter to the requested segment + shape the response.
  // For the Board Members drilldown we also compute each trustee's
  // "secondary role" — the segment they'd land in with Trustee removed.
  const isBoardSegment = segment === 'Board Members';
  const donors: SegmentDonor[] = [];
  for (const [cid, v] of byDonor) {
    // Drop constituents with no qualifying attribution (would be $0).
    if (!(v.hasType1 || v.hasType2 || v.hasSoft)) continue;
    if (classifySegment(rolesRawByDonor.get(cid) ?? null, roleByDonor.get(cid) ?? null) !== segment) continue;
    // Gap-fill: direct donors count their full type-1 total (sum of all
    // their gifts); donors with no direct gift count their soft credits,
    // deduped by hard_credit_gift_id (so 11 monthly $540s = $5,940).
    const received = v.hasType1 ? v.type1 : v.soft;
    donors.push({
      constituentId: String(cid),
      constituentName: v.name || `Donor ${cid}`,
      donationsReceived: received,
      outstandingPledges: v.pledged,
      total: received + v.pledged,
      lastGiftDate: v.lastGiftDate,
      primaryDevelopmentRole: roleByDonor.get(cid) ?? 'Other',
      secondaryRole: isBoardSegment
        ? classifySegment(
            (rolesRawByDonor.get(cid) ?? '').replace(/Trustee[^,]*/gi, '').replace(/,\s*,/g, ',').trim(),
            roleByDonor.get(cid) ?? null,
          )
        : null,
    });
  }
  donors.sort((a, b) => b.total - a.total);

  return NextResponse.json({ segment, count: donors.length, donors });
}
