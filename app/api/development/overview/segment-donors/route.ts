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
// donationsReceived = SUM(amount) on type-1 + type-3 Donation Soft
// Credits; outstandingPledges = SUM(pledge_balance) on type-2; total =
// the two combined. Grouped by constituent, sorted by total DESC. (Soft
// credits are included in segment cards per the 2026-06-11 spec.)

const FY26_CAMPAIGN = 'Operating 2025-2026';
const GIFT_TYPE_DONATION = 1;
const GIFT_TYPE_PLEDGE = 2;
const GIFT_TYPE_SOFT_CREDIT = 3;
const SOFT_CREDIT_TYPE_DONATION = 1;

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
        .select('constituent_id, constituent_name, amount, pledge_balance, gift_type, soft_credit_type, date')
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

  // 2. Aggregate per constituent.
  const byDonor = new Map<number, { name: string; received: number; pledged: number; lastGiftDate: string | null }>();
  for (const g of gifts) {
    if (g.constituent_id == null) continue;
    // Only Donation Soft Credits (type 3 + soft_credit_type 1) count;
    // skip any other type-3 row so it doesn't create a $0 donor entry.
    if (g.gift_type === GIFT_TYPE_SOFT_CREDIT && g.soft_credit_type !== SOFT_CREDIT_TYPE_DONATION) continue;
    const cid = g.constituent_id;
    const entry = byDonor.get(cid) ?? { name: '', received: 0, pledged: 0, lastGiftDate: null };
    if (g.constituent_name && !entry.name) entry.name = g.constituent_name;
    if (g.gift_type === GIFT_TYPE_DONATION) entry.received += Number(g.amount || 0);
    else if (g.gift_type === GIFT_TYPE_PLEDGE) entry.pledged += Number(g.pledge_balance || 0);
    else if (g.gift_type === GIFT_TYPE_SOFT_CREDIT) entry.received += Number(g.amount || 0);
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
  const donors: SegmentDonor[] = [];
  for (const [cid, v] of byDonor) {
    if (classifySegment(rolesRawByDonor.get(cid) ?? null, roleByDonor.get(cid) ?? null) !== segment) continue;
    donors.push({
      constituentId: String(cid),
      constituentName: v.name || `Donor ${cid}`,
      donationsReceived: v.received,
      outstandingPledges: v.pledged,
      total: v.received + v.pledged,
      lastGiftDate: v.lastGiftDate,
      primaryDevelopmentRole: roleByDonor.get(cid) ?? 'Other',
    });
  }
  donors.sort((a, b) => b.total - a.total);

  return NextResponse.json({ segment, count: donors.length, donors });
}
