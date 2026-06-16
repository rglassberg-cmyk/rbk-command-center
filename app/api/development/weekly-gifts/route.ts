import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// Valid gift type codes (cash-only per Sara)
// 1 = Donation, 3 = Soft Credit
// Excluded: 2 = Pledge commitment, 5 = Soft Credit on Pledge
const CASH_GIFT_TYPE_CODES = new Set([1, 3]);

interface CachedGift {
  id: number;
  gift_type: number;
  constituent_id: number;
  constituent_name: string;
  date: string;
  amount: number;
  fund: string | null;
  event: string | null;
  soft_credit_type: number | null;
  hard_credit_gift_id: number | null;
  fundraising_activity: string | null;
  apply_to_pledge: boolean | null;
  anonymous: boolean | null;
  in_kind_gift_description: string | null;
  raw_data: Record<string, unknown> | null;
}

interface DisplayGift {
  id: number;
  constituent_id: number;
  displayName: string;
  displayEvent: string;
  fund: string | null;
  event: string | null;
  fundraising_activity: string | null;
  amount: number;
  date: string;
  gift_type: number;
  isPledgePayment: boolean;
  isSoftCredit: boolean;
  isRefund: boolean;
  softCreditType: number | null;
  anonymous: boolean;
  constituentType: 'person' | 'organization';
  note: { text: string; author: string; updated_at: string } | null;
}

function getConstituentType(gift: CachedGift): 'person' | 'organization' {
  const rt = gift.raw_data?.constituent_record_type;
  if (typeof rt === 'string' && rt.toLowerCase().includes('organization')) return 'organization';
  return 'person';
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const effectiveWsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  // Module gating: check workspace has development module enabled
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
  } catch {
    // Fail open if workspace lookup fails
  }

  const url = new URL(request.url);

  // Parse days param (0 = today only, 7, 14, 30 = past N days incl. today).
  const daysParam = parseInt(url.searchParams.get('days') || '7');
  const days = [0, 7, 14, 30].includes(daysParam) ? daysParam : 7;

  // Step 1: Read all gifts from gifts_cache (paginated to bypass Supabase row limit)
  let allGifts: CachedGift[];
  try {
    const collected: CachedGift[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('*')
        .eq('workspace_id', effectiveWsId)
        // Exclude SAR Academy's own internal journal entries (e.g. the $900K
        // operating transfer) from the weekly feed.
        .neq('constituent_name', 'SAR Academy')
        .order('date', { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('[WEEKLY GIFTS] Cache query failed:', error);
        return NextResponse.json({ error: 'Failed to read gifts cache' }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      collected.push(...(data as CachedGift[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    allGifts = collected;
  } catch (error) {
    console.error('[WEEKLY GIFTS] Cache query exception:', error);
    return NextResponse.json({ error: String(error), step: 'gifts' }, { status: 500 });
  }

  // Step 2: Filter by date (past N days, ET timezone)
  const now = new Date();
  const etFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  const todayET = etFormatter.format(now);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - days);
  const weekAgoET = etFormatter.format(weekAgo);

  let recentGifts = allGifts.filter(g => {
    if (!g.date) return false;
    const giftDate = g.date.split('T')[0];
    return giftDate >= weekAgoET && giftDate <= todayET;
  });

  // Step 3: Filter to cash gift types (codes 1=Donation, 3=Soft Credit), exclude in-kind
  recentGifts = recentGifts.filter(g => CASH_GIFT_TYPE_CODES.has(g.gift_type));
  recentGifts = recentGifts.filter(g => !g.in_kind_gift_description || g.in_kind_gift_description.trim() === '');
  // Exclude internal "SAR Academy" accounting entries (e.g. a ~$900K
  // transfer that isn't a real donor gift). The DB query already drops the
  // exact "SAR Academy" string; this catches variants ("The SAR Academy",
  // "SAR Academy of Riverdale", etc.) — equivalent to ILIKE '%SAR%Academy%'.
  recentGifts = recentGifts.filter(g => !/sar.*academy/i.test(g.constituent_name || ''));

  // Step 4: Soft credit deduplication using hard_credit_gift_id linkage
  // Primary dedup: group by root gift ID (hard_credit_gift_id links soft credits to their hard credit)
  const rootGroups = new Map<number, CachedGift[]>();
  const unlinked: CachedGift[] = []; // gifts without hard_credit_gift_id linkage

  for (const g of recentGifts) {
    if (g.hard_credit_gift_id != null) {
      // This is a soft credit — group under the hard credit's ID
      const rootId = g.hard_credit_gift_id;
      const arr = rootGroups.get(rootId) || [];
      arr.push(g);
      rootGroups.set(rootId, arr);
    } else {
      // This might be a hard credit — check if any soft credits reference it
      const existing = rootGroups.get(g.id);
      if (existing) {
        existing.push(g);
      } else {
        rootGroups.set(g.id, [g]);
      }
    }
  }

  const deduped: CachedGift[] = [];

  for (const [, group] of rootGroups) {
    if (group.length === 1) {
      deduped.push(group[0]);
    } else {
      // Prefer soft_credit_type === 1 (primary soft credit to individual)
      // Then fall back to gift_type === 1 (hard credit)
      const primarySoftCredit = group.find(g => g.soft_credit_type === 1);
      const hardCredit = group.find(g => g.gift_type === 1);
      deduped.push(primarySoftCredit || hardCredit || group[0]);
    }
  }

  // Secondary dedup for unlinked gifts (fallback: same donor + date + amount + event/fund)
  // This handles gifts that don't have hard_credit_gift_id set
  const seen = new Set(deduped.map(g => g.id));
  const fallbackGroups = new Map<string, CachedGift[]>();
  for (const g of deduped) {
    const key = `${g.constituent_id}|${g.date}|${g.amount}|${g.event || g.fund || ''}`;
    const arr = fallbackGroups.get(key) || [];
    arr.push(g);
    fallbackGroups.set(key, arr);
  }

  const finalDeduped: CachedGift[] = [];
  for (const [, group] of fallbackGroups) {
    if (group.length === 1) {
      finalDeduped.push(group[0]);
    } else {
      const softCreditRow = group.find(g => g.soft_credit_type === 1);
      finalDeduped.push(softCreditRow || group[0]);
    }
  }

  // Step 5: Build display records
  const displayGifts: DisplayGift[] = finalDeduped.map(g => ({
    id: g.id,
    constituent_id: g.constituent_id,
    displayName: g.constituent_name || 'Unknown',
    displayEvent: (g.event && g.event !== 'None' ? g.event : null) || (g.fund && g.fund !== 'None' ? g.fund : null) || 'Unspecified',
    fund: g.fund || null,
    event: g.event || null,
    fundraising_activity: g.fundraising_activity || null,
    amount: g.amount,
    date: g.date,
    gift_type: g.gift_type,
    isPledgePayment: g.apply_to_pledge === true,
    isSoftCredit: g.soft_credit_type === 1,
    isRefund: g.amount < 0,
    softCreditType: g.soft_credit_type ?? null,
    anonymous: g.anonymous === true,
    constituentType: getConstituentType(g),
    note: null,
  }));

  // Sort by amount descending
  displayGifts.sort((a, b) => b.amount - a.amount);

  // Step 6: Fetch notes from Supabase
  try {
    const giftIds = displayGifts.map(g => String(g.id));
    if (giftIds.length > 0) {
      const { data: notes } = await supabaseAdmin
        .from('gift_notes')
        .select('gift_id, note, author_email, updated_at')
        .eq('workspace_id', effectiveWsId)
        .in('gift_id', giftIds);

      if (notes) {
        const noteMap = new Map(notes.map(n => [String(n.gift_id), n]));
        for (const gift of displayGifts) {
          const n = noteMap.get(String(gift.id));
          if (n) {
            gift.note = { text: n.note, author: n.author_email, updated_at: n.updated_at };
          }
        }
      }
    }
  } catch (error) {
    console.error('[WEEKLY GIFTS] Notes fetch failed (non-fatal):', error);
  }

  // Step 7: Fetch sync metadata
  let fetchedAt: string | null = null;
  let syncStatus = 'unknown';
  try {
    const { data: meta } = await supabaseAdmin
      .from('gifts_sync_meta')
      .select('last_sync_at, last_sync_status')
      .eq('workspace_id', effectiveWsId)
      .single();
    if (meta) {
      fetchedAt = meta.last_sync_at;
      syncStatus = meta.last_sync_status;
    }
  } catch { /* non-fatal */ }

  // Step 8: Summary
  const summary = {
    totalGifts: displayGifts.length,
    totalAmount: displayGifts.reduce((sum, g) => sum + g.amount, 0),
    newGiftsAmount: displayGifts.filter(g => !g.isPledgePayment).reduce((sum, g) => sum + g.amount, 0),
    pledgePaymentsAmount: displayGifts.filter(g => g.isPledgePayment).reduce((sum, g) => sum + g.amount, 0),
    countRefunds: displayGifts.filter(g => g.isRefund).length,
  };

  console.log('[WEEKLY GIFTS] Returning', displayGifts.length, 'gifts for workspace', effectiveWsId);

  return NextResponse.json({
    gifts: displayGifts,
    summary,
    dateRange: { weekStart: weekAgoET, weekEnd: todayET, days },
    fetchedAt,
    syncStatus,
  });
}
